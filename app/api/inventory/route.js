import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { appendAuditEvent, getWorkspace } from "@/lib/db";
import { getOrganizationAccess } from "@/lib/organization-access";
import { hasPermission } from "@/lib/team-permissions";
import { guardMutation, readLimitedJson, requestBodyErrorResponse } from "@/lib/request-security";
import { enforceRateLimit } from "@/lib/rate-limit";
import { inventoryTenant, normalizeMovementLines, validateProducts } from "@/lib/inventory";
import {
  applyInventoryBatch,
  createInventoryOrder,
  createInventoryProducts,
  listInventory,
  undoInventoryBatch,
} from "@/lib/inventory-db";
import { reportServerError } from "@/lib/server-observability";
import { claimIdempotency, completeIdempotency, failIdempotency } from "@/lib/idempotency-db";
import { hashIdempotencyRequest, hashIdempotencyValue, normalizeIdempotencyKey } from "@/lib/idempotency";

export const runtime = "nodejs";

const text = (value, max = 120) => String(value ?? "").trim().slice(0, max);
const uuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
const date = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : null;
const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

function auditInventory(auth, { action, subjectType, subjectId, newState }) {
  return appendAuditEvent({
    userId: auth.access.ownerUserId,
    actorUserId: auth.user.id,
    organizationId: auth.access.organizationId,
    action,
    origin: "api/inventory",
    subjectType,
    subjectId,
    newState,
  }).catch(() => null);
}

async function authorized(request, permissions = ["inventory"]) {
  const user = await getSession(request);
  if (!user) return { response: NextResponse.json({ error: "Não autenticado" }, { status: 401 }) };
  const access = await getOrganizationAccess(user);
  if (!permissions.some((permission) => hasPermission(access, permission))) {
    return { response: NextResponse.json({ error: "Sem permissão para esta operação." }, { status: 403 }) };
  }
  return { user, access, tenantId: inventoryTenant(access) };
}

async function migrateLegacyInventory({ access, tenantId, userId }) {
  const current = await listInventory(tenantId);
  if (current.products.length) return current;
  const workspace = await getWorkspace(access.ownerUserId, access.organizationId);
  const legacy = (workspace?.payload?.inventoryState?.products || []).filter((item) => item?.name && item?.sku);
  if (!legacy.length) return current;
  const checked = validateProducts(legacy.map((item) => ({
    name: item.name,
    category: "Migrado",
    unit: "un",
    variants: [{
      name: "Padrão", sku: item.sku, quantity: item.quantity, minimumQuantity: item.minimum,
      unitCost: item.unitCost, salePrice: 0, location: item.location,
    }],
  })));
  if (checked.error) return current;
  try {
    const created = await createInventoryProducts({ tenantId, products: checked.products });
    const lines = created.flatMap((product) => product.variants
      .filter((variant) => variant.quantity > 0)
      .map((variant) => ({ variantId: variant.id, quantity: variant.quantity, delta: variant.quantity,
        unitCost: variant.unitCost, unitPrice: 0, lotCode: "", expiresOn: "" })));
    if (lines.length) await applyInventoryBatch({
      tenantId, userId, kind: "import", reference: "Migração do estoque anterior",
      note: "Migração automática e auditável do workspace", lines,
    });
  } catch (error) {
    // Duas leituras simultâneas podem tentar migrar. A restrição de SKU impede duplicação.
    if (!String(error?.message || "").toLowerCase().includes("unique")) throw error;
  }
  return listInventory(tenantId);
}

export async function GET(request) {
  const limited = await enforceRateLimit(request, { scope: "inventory-read", limit: 120 });
  if (limited) return limited;
  const auth = await authorized(request, ["inventory", "commerce"]);
  if (auth.response) return auth.response;
  try {
    const inventory = await migrateLegacyInventory({ access: auth.access, tenantId: auth.tenantId, userId: auth.user.id });
    return NextResponse.json({ inventory });
  } catch (error) {
    reportServerError(error, { request, route: "/api/inventory", operation: "read" });
    return NextResponse.json({ error: "Não foi possível carregar o estoque." }, { status: 500 });
  }
}

export async function POST(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const limited = await enforceRateLimit(request, { scope: "inventory-write", limit: 60 });
  if (limited) return limited;
  const auth = await authorized(request, ["inventory", "commerce"]);
  if (auth.response) return auth.response;
  let idempotencyContext = null;
  try {
    const body = await readLimitedJson(request, { maxBytes: 750_000, maxDepth: 8, maxNodes: 10_000, maxStringLength: 5_000 });
    const action = text(body.action, 40);
    const requiredPermission = action === "order" ? "commerce" : "inventory";
    if (!hasPermission(auth.access, requiredPermission)) {
      return NextResponse.json({ error: "Sem permissão para esta operação." }, { status: 403 });
    }
    const idempotencyKey = normalizeIdempotencyKey(request.headers.get("idempotency-key"));
    if (!idempotencyKey) return NextResponse.json({ error: "Idempotency-Key obrigatório ou inválido." }, { status: 400 });
    const keyHash = hashIdempotencyValue(idempotencyKey);
    idempotencyContext = {
      userId: auth.user.id,
      operation: `inventory.${action}`,
      keyHash,
      requestHash: hashIdempotencyRequest(body),
    };
    const claim = await claimIdempotency({ ...idempotencyContext, organizationId: auth.access.organizationId });
    if (claim.state === "conflict") return NextResponse.json({ error: "A mesma chave de idempotência foi usada com outro conteúdo." }, { status: 409 });
    if (claim.state === "pending") return NextResponse.json({ error: "Esta operação ainda está em processamento." }, { status: 409, headers: { "Retry-After": "2" } });
    if (claim.state === "replay") return NextResponse.json(claim.body, { status: claim.status, headers: { "Idempotent-Replayed": "true" } });

    const complete = async (responseBody, status = 200) => {
      const completed = await completeIdempotency({ ...idempotencyContext, status, body: responseBody });
      if (!completed) throw new Error("IDEMPOTENCY_COMPLETION_FAILED");
      return NextResponse.json(responseBody, { status });
    };

    if (action === "create-products" || action === "import-products") {
      const checked = validateProducts(body.products, { maxProducts: action === "import-products" ? 500 : 30 });
      if (checked.error) return complete({ error: checked.error }, 400);
      const created = await createInventoryProducts({ tenantId: auth.tenantId, products: checked.products });
      const initialLines = created.flatMap((product) => product.variants
        .filter((variant) => variant.quantity > 0)
        .map((variant) => ({ variantId: variant.id, quantity: variant.quantity, delta: variant.quantity,
          unitCost: variant.unitCost, unitPrice: variant.salePrice, lotCode: variant.lotCode, expiresOn: variant.expiresOn })));
      let batch = null;
      if (initialLines.length) batch = await applyInventoryBatch({
        tenantId: auth.tenantId, userId: auth.user.id,
        kind: action === "import-products" ? "import" : "entry",
        reference: text(body.reference || (action === "import-products" ? "Importação de produtos" : "Cadastro inicial"), 120),
        note: "Saldo inicial informado no cadastro", lines: initialLines,
      });
      await auditInventory(auth, {
        action: action === "import-products" ? "inventory.products.imported" : "inventory.products.created",
        subjectType: "inventory_batch",
        subjectId: batch?.id || auth.access.organizationId,
        newState: { productCount: created.length, initialBalance: Boolean(batch) },
      });
      return complete({ created: created.length, batch, inventory: await listInventory(auth.tenantId) }, 201);
    }

    if (action === "entry") {
      const lines = normalizeMovementLines(body.lines, { direction: 1 });
      if (!lines) return complete({ error: "Informe ao menos um item com quantidade válida." }, 400);
      const batch = await applyInventoryBatch({
        tenantId: auth.tenantId, userId: auth.user.id, kind: "entry",
        reference: text(body.reference, 120), supplier: text(body.supplier, 120), note: text(body.note, 300), lines,
      });
      await auditInventory(auth, { action: "inventory.entry.created", subjectType: "inventory_batch", subjectId: batch.id,
        newState: { reference: text(body.reference, 120), lineCount: lines.length } });
      return complete({ batch, inventory: await listInventory(auth.tenantId) }, 201);
    }

    if (action === "order") {
      const type = body.type === "purchase" ? "purchase" : "sale";
      const lines = normalizeMovementLines(body.lines, { direction: 1, maxLines: 100 });
      if (!lines) return complete({ error: "Adicione produtos e quantidades válidas ao pedido." }, 400);
      const subtotal = money(lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0));
      const discountAmount = money(Math.max(0, Number(body.discountAmount) || 0));
      if (discountAmount > subtotal) return complete({ error: "O desconto não pode superar o subtotal." }, 400);
      if (discountAmount > 0 && !hasPermission(auth.access, "discounts")) return complete({ error: "Seu cargo não permite conceder descontos." }, 403);
      const paymentMethod = ["cash","pix","debit","credit","transfer","other"].includes(body.paymentMethod) ? body.paymentMethod : "pending";
      const dueOn = date(body.dueOn);
      if (paymentMethod === "pending" && !dueOn) return complete({ error: "Informe o vencimento da operação a prazo." }, 400);
      const order = await createInventoryOrder({
        tenantId: auth.tenantId, userId: auth.user.id, type,
        reference: text(body.reference, 120), partner: text(body.partner, 120), customerId: uuid(body.customerId) ? body.customerId : "",
        lines, discountAmount, paymentMethod, dueOn, idempotencyKeyHash: keyHash,
      });
      await auditInventory(auth, { action: `inventory.order.${type}.created`, subjectType: "inventory_order", subjectId: order.id,
        newState: { total: order.total, paymentMethod: order.paymentMethod, paymentStatus: order.paymentStatus, lineCount: lines.length } });
      return complete({ order, inventory: await listInventory(auth.tenantId) }, 201);
    }

    if (action === "undo-batch") {
      if (!uuid(body.batchId)) return complete({ error: "Operação inválida." }, 400);
      const reversal = await undoInventoryBatch({ tenantId: auth.tenantId, userId: auth.user.id, batchPublicId: body.batchId });
      if (!reversal) return complete({ error: "Operação não encontrada ou já desfeita." }, 404);
      await auditInventory(auth, { action: "inventory.batch.reversed", subjectType: "inventory_batch", subjectId: body.batchId,
        newState: { reversalId: reversal.id } });
      return complete({ reversal, inventory: await listInventory(auth.tenantId) });
    }

    return complete({ error: "Ação de estoque desconhecida." }, 400);
  } catch (error) {
    if (idempotencyContext) await failIdempotency(idempotencyContext).catch(() => {});
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    const message = String(error?.message || "");
    if (/unique|inventory_variants_tenant_id_sku/i.test(message)) {
      return NextResponse.json({ error: "Um dos SKUs já está cadastrado nesta empresa." }, { status: 409 });
    }
    if (/INSUFFICIENT|UNDO_WOULD|division by zero|22012/i.test(message)) {
      return NextResponse.json({ error: "A operação deixaria o estoque negativo ou contém um produto inválido." }, { status: 409 });
    }
    reportServerError(error, { request, route: "/api/inventory", operation: "mutation" });
    return NextResponse.json({ error: "Não foi possível concluir a operação de estoque." }, { status: 500 });
  }
}
