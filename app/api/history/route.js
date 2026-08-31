import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listHistories, MAX_DOCUMENTS_PER_USER, saveHistory, serializeHistory } from "@/lib/db";
import { guardMutation, readLimitedJson, requestBodyErrorResponse } from "@/lib/request-security";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getOrganizationAccess, isPublicHistoryId } from "@/lib/organization-access";
import { filterHistoryForAccess, hasPermission, permissionForCalculationType } from "@/lib/team-permissions";
import { reportServerError } from "@/lib/server-observability";
import { claimIdempotency, completeIdempotency, enqueueOutboxEvent, failIdempotency } from "@/lib/idempotency-db";
import { hashIdempotencyRequest, hashIdempotencyValue, normalizeIdempotencyKey } from "@/lib/idempotency";

export const runtime = "nodejs";

export async function GET(request) {
  const limited = await enforceRateLimit(request, { scope: "history-read", limit: 120 });
  if (limited) return limited;
  // Toda consulta de histórico exige uma sessão válida.
  const user = await getSession(request);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const access = await getOrganizationAccess(user);
  if (!hasPermission(access, "history")) {
    return NextResponse.json({ error: "Sem permissão para acessar o histórico." }, { status: 403 });
  }

  const searchParams = new URL(request.url).searchParams;
  const type = searchParams.get("type");
  const cursor = searchParams.get("cursor");
  const limit = searchParams.get("limit");
  // O ID do proprietário delimita o espaço compartilhado da empresa.
  const page = await listHistories(access.ownerUserId, type, { cursor, limit });
  if (page.invalidCursor) {
    return NextResponse.json({ error: "Cursor de paginação inválido." }, { status: 400 });
  }
  const rows = page.rows;
  const items = rows.map(serializeHistory).map((item) => filterHistoryForAccess(item, access)).filter(Boolean);
  return NextResponse.json({ items, nextCursor: page.nextCursor });
}

export async function POST(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const limited = await enforceRateLimit(request, { scope: "history-write", limit: 30 });
  if (limited) return limited;
  const user = await getSession(request);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const access = await getOrganizationAccess(user);
  const idempotencyKey = normalizeIdempotencyKey(request.headers.get("idempotency-key"));
  if (!idempotencyKey) {
    return NextResponse.json({ error: "Idempotency-Key obrigatório ou inválido." }, { status: 400 });
  }
  const operation = "history.save";
  let idempotencyContext = null;

  const contentLength = Number(request.headers.get("content-length") || 0);
  // Rejeita históricos excessivamente grandes antes de carregar o corpo inteiro.
  if (contentLength > 512_000) {
    return NextResponse.json({ error: "Histórico muito grande" }, { status: 413 });
  }

  try {
    const { id, title, calculationType, payload } = await readLimitedJson(request, {
      maxBytes: 512_000, maxDepth: 12, maxNodes: 12_000, maxStringLength: 20_000,
    });
    const safeId = isPublicHistoryId(id) ? id : null;
    const safeTitle = String(title || "").trim().slice(0, 100);
    const safeType = String(calculationType || "").trim().slice(0, 50);
    if (!safeTitle || !safeType || !payload || JSON.stringify(payload).length > 500_000) {
      return NextResponse.json({ error: "Histórico inválido ou muito grande." }, { status: 400 });
    }
    const permission = permissionForCalculationType(safeType);
    if ((!permission && !["owner", "personal"].includes(access.role)) || (permission && !hasPermission(access, permission)) || !hasPermission(access, "history")) {
      return NextResponse.json({ error: "Sem permissão para salvar este documento." }, { status: 403 });
    }
    const filteredItem = filterHistoryForAccess({ calculation_type: safeType, payload }, access);
    if (!filteredItem) return NextResponse.json({ error: "Tipo de documento não autorizado." }, { status: 403 });

    const keyHash = hashIdempotencyValue(idempotencyKey);
    const requestHash = hashIdempotencyRequest({ id: safeId, title: safeTitle, calculationType: safeType, payload: filteredItem.payload });
    idempotencyContext = { userId: user.id, operation, keyHash, requestHash };
    const claim = await claimIdempotency({
      ...idempotencyContext,
      organizationId: access.organizationId,
    });
    if (claim.state === "conflict") {
      return NextResponse.json({ error: "A mesma chave de idempotência foi usada com outro conteúdo." }, { status: 409 });
    }
    if (claim.state === "pending") {
      return NextResponse.json({ error: "Esta gravação ainda está em processamento." }, { status: 409, headers: { "Retry-After": "2" } });
    }
    if (claim.state === "replay") {
      return NextResponse.json(claim.body, { status: claim.status, headers: { "Idempotent-Replayed": "true" } });
    }

    // Com um ID ativo, salvar atualiza o mesmo documento em vez de criar cópias no histórico.
    const saved = await saveHistory({
      id: safeId,
      userId: access.ownerUserId,
      title: safeTitle,
      calculationType: safeType,
      payload: filteredItem.payload,
    });
    const responseBody = { item: serializeHistory(saved.item), created: saved.created, limit: MAX_DOCUMENTS_PER_USER };
    const responseStatus = saved.created ? 201 : 200;
    const completed = await completeIdempotency({ ...idempotencyContext, status: responseStatus, body: responseBody });
    if (!completed) throw new Error("IDEMPOTENCY_COMPLETION_FAILED");
    await enqueueOutboxEvent({
      organizationId: access.organizationId,
      aggregateType: "history",
      aggregateId: saved.item.id,
      eventType: saved.created ? "history.created" : "history.updated",
      dedupeKey: keyHash,
      payload: { calculationType: safeType },
    }).catch((outboxError) => reportServerError(outboxError, { request, route: "/api/history", operation: "enqueue-outbox" }));
    return NextResponse.json(responseBody, { status: responseStatus });
  } catch (error) {
    if (idempotencyContext) await failIdempotency(idempotencyContext).catch(() => {});
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    if (error?.code === "DOCUMENT_LIMIT_REACHED") {
      return NextResponse.json(
        { error: `Você atingiu o limite de ${MAX_DOCUMENTS_PER_USER} documentos. Exclua um documento antigo para criar outro.` },
        { status: 409 },
      );
    }
    reportServerError(error, { request, route: "/api/history", operation: "save" });
    return NextResponse.json({ error: "Não foi possível salvar o histórico." }, { status: 500 });
  }
}
