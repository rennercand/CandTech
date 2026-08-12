import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getWorkspace } from "@/lib/db";
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

export const runtime = "nodejs";

const text = (value, max = 120) => String(value ?? "").trim().slice(0, max);
const uuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));

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
  const workspace = await getWorkspace(access.ownerUserId);
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
  try {
    const body = await readLimitedJson(request, { maxBytes: 750_000, maxDepth: 8, maxNodes: 10_000, maxStringLength: 5_000 });
    const action = text(body.action, 40);
    const requiredPermission = action === "order" ? "commerce" : "inventory";
    if (!hasPermission(auth.access, requiredPermission)) {
      return NextResponse.json({ error: "Sem permissão para esta operação." }, { status: 403 });
    }

    if (action === "create-products" || action === "import-products") {
      const checked = validateProducts(body.products, { maxProducts: action === "import-products" ? 500 : 30 });
      if (checked.error) return NextResponse.json({ error: checked.error }, { status: 400 });
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
      return NextResponse.json({ created: created.length, batch, inventory: await listInventory(auth.tenantId) }, { status: 201 });
    }

    if (action === "entry") {
      const lines = normalizeMovementLines(body.lines, { direction: 1 });
      if (!lines) return NextResponse.json({ error: "Informe ao menos um item com quantidade válida." }, { status: 400 });
      const batch = await applyInventoryBatch({
        tenantId: auth.tenantId, userId: auth.user.id, kind: "entry",
        reference: text(body.reference, 120), supplier: text(body.supplier, 120), note: text(body.note, 300), lines,
      });
      return NextResponse.json({ batch, inventory: await listInventory(auth.tenantId) }, { status: 201 });
    }

    if (action === "order") {
      const type = body.type === "purchase" ? "purchase" : "sale";
      const lines = normalizeMovementLines(body.lines, { direction: 1, maxLines: 100 });
      if (!lines) return NextResponse.json({ error: "Adicione produtos e quantidades válidas ao pedido." }, { status: 400 });
      const order = await createInventoryOrder({
        tenantId: auth.tenantId, userId: auth.user.id, type,
        reference: text(body.reference, 120), partner: text(body.partner, 120), lines,
      });
      return NextResponse.json({ order, inventory: await listInventory(auth.tenantId) }, { status: 201 });
    }

    if (action === "undo-batch") {
      if (!uuid(body.batchId)) return NextResponse.json({ error: "Operação inválida." }, { status: 400 });
      const reversal = await undoInventoryBatch({ tenantId: auth.tenantId, userId: auth.user.id, batchPublicId: body.batchId });
      if (!reversal) return NextResponse.json({ error: "Operação não encontrada ou já desfeita." }, { status: 404 });
      return NextResponse.json({ reversal, inventory: await listInventory(auth.tenantId) });
    }

    return NextResponse.json({ error: "Ação de estoque desconhecida." }, { status: 400 });
  } catch (error) {
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
