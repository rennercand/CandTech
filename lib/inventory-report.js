import { historyXlsx } from "./history-xlsx.js";
import { hasPermission } from "./team-permissions.js";

export function canExportInventory(access, { drive = false } = {}) {
  const canReadStock = hasPermission(access, "inventory") || hasPermission(access, "commerce");
  return canReadStock && hasPermission(access, "exports") && (!drive || hasPermission(access, "drive"));
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && Number.isFinite(value)) return String(value).replace(".", ",");
  let text = String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function inventorySnapshotRows(inventory) {
  return inventory.products.flatMap((product) => product.variants.map((variant) => ({
    product: product.name,
    variation: variant.name,
    sku: variant.sku,
    quantity: Number(variant.quantity) || 0,
    minimum: Number(variant.minimumQuantity) || 0,
    unitCost: Number(variant.unitCost) || 0,
    salePrice: Number(variant.salePrice) || 0,
    category: product.category || "",
    unit: product.unit || "un",
    location: variant.location || "",
  })));
}

export function inventoryCsv(inventory) {
  const headers = ["Produto", "Variação", "SKU", "Quantidade", "Estoque mínimo", "Custo unitário", "Preço de venda", "Categoria", "Unidade", "Localização", "Lote", "Validade"];
  const rows = inventorySnapshotRows(inventory).map((row) => [
    row.product, row.variation, row.sku, row.quantity, row.minimum, row.unitCost,
    row.salePrice, row.category, row.unit, row.location, "", "",
  ]);
  return ["sep=;", headers.map(csvCell).join(";"), ...rows.map((row) => row.map(csvCell).join(";"))].join("\r\n");
}

export function inventoryReportItem(inventory, title = "Estoque CandTech") {
  const stock = inventorySnapshotRows(inventory).map((row) => ({
    name: row.variation === "Padrão" ? row.product : `${row.product} · ${row.variation}`,
    sku: row.sku,
    quantity: row.quantity,
    minimum: row.minimum,
    unitCost: row.unitCost,
    salePrice: row.salePrice,
    category: row.category,
    unit: row.unit,
    location: row.location,
  }));
  const orders = inventory.orders.map((order) => ({
    type: order.type === "sale" ? "venda" : "compra",
    number: order.reference,
    partner: order.partner,
    sku: "",
    quantity: 0,
    date: String(order.created_at || "").slice(0, 10),
    amount: Number(order.total) || 0,
    status: order.status,
  }));
  const lots = (inventory.lots || []).map((lot) => ({
    product: `${lot.product_name} · ${lot.variant_name}`,
    sku: lot.sku,
    lotCode: lot.lot_code,
    expiresOn: lot.expires_on ? String(lot.expires_on).slice(0, 10) : "",
    receivedQuantity: Number(lot.available_quantity ?? lot.received_quantity) || 0,
  }));
  return {
    id: "estoque",
    title,
    calculation_type: "estoque-logistica",
    created_at: new Date().toISOString(),
    payload: { workspace: { inventoryState: { products: stock }, commerceOrders: orders, inventoryLots: lots } },
  };
}

export function inventoryXlsx(inventory, title) {
  return historyXlsx(inventoryReportItem(inventory, title));
}

export function inventoryFilename(extension, date = new Date()) {
  return `estoque-candtech-${date.toISOString().slice(0, 10)}.${extension}`;
}
