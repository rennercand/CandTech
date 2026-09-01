import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { appendAuditEvent } from "@/lib/db";
import { requirePermission } from "@/lib/organization-access";
import { inventoryTenant } from "@/lib/inventory";
import { createServiceOrder, listServiceOrders, transitionServiceOrder, completeServiceOrder } from "@/lib/service-db";
import { claimIdempotency, completeIdempotency, failIdempotency } from "@/lib/idempotency-db";
import { hashIdempotencyRequest, hashIdempotencyValue, normalizeIdempotencyKey } from "@/lib/idempotency";
import { guardMutation, readLimitedJson, requestBodyErrorResponse } from "@/lib/request-security";
import { enforceRateLimit } from "@/lib/rate-limit";
import { reportServerError } from "@/lib/server-observability";

export const runtime = "nodejs";
const clean = (value, max = 160) => String(value || "").normalize("NFKC").trim().slice(0, max);
const number = (value, max = 100_000_000) => { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? Math.min(max, parsed) : 0; };
const publicId = (value) => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(value || ""));
const simpleDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : "";
const timestamp = (value) => { const date = new Date(value || ""); return Number.isFinite(date.getTime()) ? date.toISOString() : ""; };

async function authorize(request) {
  const user = await getSession(request);
  if (!user) return { response: NextResponse.json({ error: "Não autenticado" }, { status: 401 }) };
  const access = await requirePermission(user, "services");
  if (!access) return { response: NextResponse.json({ error: "Sem permissão para serviços" }, { status: 403 }) };
  return { user, access, tenantId: inventoryTenant(access) };
}

function normalizeService(input) {
  const recurrence = ["weekly", "monthly", "yearly"].includes(input?.recurrence) ? input.recurrence : "none";
  const recurrenceCount = recurrence === "none" ? 1 : Math.min(60, Math.max(2, Math.trunc(Number(input?.recurrenceCount) || 2)));
  const items = Array.isArray(input?.items) ? input.items.slice(0, 100).map((item) => ({
    kind: item?.kind === "material" ? "material" : "service", description: clean(item?.description, 160),
    variantId: publicId(item?.variantId) ? String(item.variantId) : "", quantity: Math.max(.001, number(item?.quantity, 1_000_000) || 1),
    unitPrice: number(item?.unitPrice), unitCost: number(item?.unitCost),
  })).filter((item) => item.description) : [];
  const title = clean(input?.title, 140);
  if (!title || !items.length || items.some((item) => item.kind === "material" && !item.variantId)) return null;
  return { customerId: clean(input?.customerId, 120), quoteNumber: clean(input?.quoteNumber, 40), title,
    description: clean(input?.description, 2_000), assignee: clean(input?.assignee, 120), location: clean(input?.location, 180),
    scheduledFor: timestamp(input?.scheduledFor), dueOn: simpleDate(input?.dueOn), status: input?.status === "quote" ? "quote" : "draft",
    recurrence, recurrenceCount, quotedAmount: number(input?.quotedAmount), estimatedCost: number(input?.estimatedCost), notes: clean(input?.notes, 4_000), items };
}

export async function GET(request) {
  const limited = await enforceRateLimit(request, { scope: "services-read", limit: 120 }); if (limited) return limited;
  const auth = await authorize(request); if (auth.response) return auth.response;
  try { return NextResponse.json({ services: await listServiceOrders(auth.tenantId) }); }
  catch (error) { reportServerError(error, { request, route: "/api/services", operation: "read" }); return NextResponse.json({ error: "Não foi possível carregar os serviços" }, { status: 500 }); }
}

export async function POST(request) {
  const blocked = guardMutation(request); if (blocked) return blocked;
  const limited = await enforceRateLimit(request, { scope: "services-write", limit: 60 }); if (limited) return limited;
  const auth = await authorize(request); if (auth.response) return auth.response;
  let context;
  try {
    const body = await readLimitedJson(request, { maxBytes: 200_000, maxDepth: 8, maxNodes: 2_000, maxStringLength: 5_000 });
    const action = clean(body.action, 30);
    const key = normalizeIdempotencyKey(request.headers.get("idempotency-key"));
    if (!key) return NextResponse.json({ error: "Idempotency-Key obrigatório" }, { status: 400 });
    context = { userId: auth.user.id, organizationId: auth.access.organizationId, operation: `services.${action}`,
      keyHash: hashIdempotencyValue(key), requestHash: hashIdempotencyRequest(body) };
    const claim = await claimIdempotency(context);
    if (claim.state === "replay") return NextResponse.json(claim.body, { status: claim.status });
    if (claim.state === "conflict") return NextResponse.json({ error: "Chave reutilizada com outra solicitação" }, { status: 409 });
    if (claim.state !== "claimed") return NextResponse.json({ error: "Operação ainda em processamento" }, { status: 409 });
    let result;
    if (action === "create") {
      const data = normalizeService(body.service); if (!data) throw Object.assign(new Error("INVALID_SERVICE"), { status: 400 });
      result = await createServiceOrder({ tenantId: auth.tenantId, ownerUserId: auth.access.ownerUserId, data });
    } else {
      if (!publicId(body.serviceId)) throw Object.assign(new Error("INVALID_SERVICE_ID"), { status: 400 });
      result = action === "complete"
        ? await completeServiceOrder({ tenantId: auth.tenantId, ownerUserId: auth.access.ownerUserId, serviceId: body.serviceId })
        : await transitionServiceOrder({ tenantId: auth.tenantId, ownerUserId: auth.access.ownerUserId, serviceId: body.serviceId, action });
      if (!result) throw Object.assign(new Error("INVALID_SERVICE_STATE"), { status: 409 });
    }
    const responseBody = { result, services: await listServiceOrders(auth.tenantId) };
    await completeIdempotency({ ...context, status: 200, body: responseBody });
    await appendAuditEvent({ userId: auth.access.ownerUserId, actorUserId: auth.user.id, organizationId: auth.access.organizationId,
      action: `service.${action}`, origin: "api/services", subjectType: "service_order", subjectId: result.id,
      newState: { status: action === "complete" ? "completed" : result.status || "created" } }).catch(() => null);
    return NextResponse.json(responseBody);
  } catch (error) {
    if (context) await failIdempotency(context).catch(() => null);
    const bodyError = requestBodyErrorResponse(error); if (bodyError) return bodyError;
    if (error.status) return NextResponse.json({ error: error.message }, { status: error.status });
    reportServerError(error, { request, route: "/api/services", operation: "write" });
    return NextResponse.json({ error: "Não foi possível atualizar a ordem de serviço" }, { status: 500 });
  }
}
