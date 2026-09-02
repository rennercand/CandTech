import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { appendAuditEvent, getDatabaseBackend } from "@/lib/db";
import { getOrganizationAccess } from "@/lib/organization-access";
import { hasPermission } from "@/lib/team-permissions";
import { enforceRateLimit } from "@/lib/rate-limit";
import { inventoryTenant } from "@/lib/inventory";
import { getInventoryDailySummary, listInventory } from "@/lib/inventory-db";
import { listServiceOrders } from "@/lib/service-db";
import { listFinancialCommitments } from "@/lib/db/finance";
import { buildTodaySnapshot } from "@/lib/today";
import { reportServerError } from "@/lib/server-observability";
import { getCashPosition, saveCashCount } from "@/lib/cash-count-db";
import { guardMutation, readLimitedJson, requestBodyErrorResponse } from "@/lib/request-security";
import { claimIdempotency, completeIdempotency, failIdempotency } from "@/lib/idempotency-db";
import { hashIdempotencyRequest, hashIdempotencyValue, normalizeIdempotencyKey } from "@/lib/idempotency";

export const runtime = "nodejs";

function localDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

export async function GET(request) {
  const limited = await enforceRateLimit(request, { scope: "today-read", limit: 120 });
  if (limited) return limited;
  const user = await getSession(request);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  try {
    const access = await getOrganizationAccess(user);
    const tenantId = inventoryTenant(access);
    const date = localDate();
    const canInventory = hasPermission(access, "inventory");
    const canCommerce = hasPermission(access, "commerce");
    const canServices = hasPermission(access, "services");
    const canFinance = hasPermission(access, "cashflow");
    const [inventory, dailySales, services, commitments, cash] = await Promise.all([
      canInventory ? listInventory(tenantId) : null,
      canCommerce ? getInventoryDailySummary(tenantId, date) : null,
      canServices ? listServiceOrders(tenantId) : null,
      canFinance ? getDatabaseBackend().then((backend) => listFinancialCommitments(backend, access.ownerUserId, access.organizationId)) : null,
      canFinance ? getCashPosition({ ownerUserId: access.ownerUserId, organizationId: access.organizationId, date }) : null,
    ]);
    return NextResponse.json({ snapshot: buildTodaySnapshot({ date, inventory, dailySales, services, commitments, cash }) }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    reportServerError(error, { request, route: "/api/today", operation: "read" });
    return NextResponse.json({ error: "Não foi possível montar as prioridades de hoje." }, { status: 500 });
  }
}

export async function POST(request) {
  const blocked = guardMutation(request); if (blocked) return blocked;
  const limited = await enforceRateLimit(request, { scope: "today-cash-count", limit: 30 }); if (limited) return limited;
  const user = await getSession(request); if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  let context = null;
  try {
    const access = await getOrganizationAccess(user);
    if (!hasPermission(access, "cashflow")) return NextResponse.json({ error: "Sem permissão para conferir o caixa." }, { status: 403 });
    const body = await readLimitedJson(request, { maxBytes: 8_000, maxDepth: 3, maxNodes: 40, maxStringLength: 300 });
    const counted = Math.round(Number(body.counted) * 100) / 100;
    if (!Number.isFinite(counted) || Math.abs(counted) > 1_000_000_000_000) return NextResponse.json({ error: "Informe um saldo contado válido." }, { status: 400 });
    const note = String(body.note || "").normalize("NFKC").trim().slice(0, 240);
    const key = normalizeIdempotencyKey(request.headers.get("idempotency-key"));
    if (!key) return NextResponse.json({ error: "Idempotency-Key obrigatório ou inválido." }, { status: 400 });
    context = { userId: user.id, organizationId: access.organizationId, operation: "today.cash-count",
      keyHash: hashIdempotencyValue(key), requestHash: hashIdempotencyRequest({ counted, note }) };
    const claim = await claimIdempotency(context);
    if (claim.state === "replay") return NextResponse.json(claim.body, { status: claim.status,
      headers: { "Idempotent-Replayed": "true", "Cache-Control": "private, no-store, max-age=0" } });
    if (claim.state === "conflict") return NextResponse.json({ error: "A chave desta conferência já foi usada com outro valor." }, { status: 409 });
    if (claim.state !== "claimed") return NextResponse.json({ error: "A conferência ainda está sendo processada." }, { status: 409 });
    const date = localDate();
    const cash = await saveCashCount({ ownerUserId: access.ownerUserId, organizationId: access.organizationId,
      actorUserId: user.id, date, counted, note });
    const responseBody = { cash };
    await completeIdempotency({ ...context, status: 201, body: responseBody });
    await appendAuditEvent({ userId: access.ownerUserId, actorUserId: user.id, organizationId: access.organizationId,
      action: "cash.counted", origin: "api/today", subjectType: "cash_count", subjectId: date,
      newState: { expected: cash.expected, counted: cash.counted, difference: cash.difference, hasNote: Boolean(note) } }).catch(() => null);
    return NextResponse.json(responseBody, { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if (context) await failIdempotency(context).catch(() => null);
    const bodyError = requestBodyErrorResponse(error); if (bodyError) return bodyError;
    reportServerError(error, { request, route: "/api/today", operation: "cash-count" });
    return NextResponse.json({ error: "Não foi possível salvar a conferência do caixa." }, { status: 500 });
  }
}
