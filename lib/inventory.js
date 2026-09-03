const text = (value, max = 120) => String(value ?? "").trim().slice(0, max);
const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const isoDate = (value) => {
  const normalized = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return "";
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === normalized ? normalized : "";
};

export function inventoryTenant(access) {
  return access?.organizationId
    ? `organization:${Number(access.organizationId)}`
    : `user:${Number(access?.ownerUserId)}`;
}

export function normalizeVariant(value = {}) {
  return {
    id: text(value.id, 36),
    name: text(value.name || "Padrão", 80) || "Padrão",
    sku: text(value.sku, 80).toUpperCase(),
    quantity: Math.max(0, number(value.quantity)),
    minimumQuantity: Math.max(0, number(value.minimumQuantity)),
    restockReminderOn: isoDate(value.restockReminderOn),
    unitCost: Math.max(0, number(value.unitCost)),
    salePrice: Math.max(0, number(value.salePrice)),
    location: text(value.location, 100),
    lotCode: text(value.lotCode, 80),
    expiresOn: isoDate(value.expiresOn),
  };
}

export function normalizeProduct(value = {}) {
  const variants = Array.isArray(value.variants) ? value.variants.map(normalizeVariant) : [];
  return {
    name: text(value.name, 120),
    category: text(value.category, 80),
    unit: text(value.unit || "un", 12).toLowerCase() || "un",
    variants,
  };
}

export function validateProducts(values, { maxProducts = 500 } = {}) {
  if (!Array.isArray(values) || !values.length || values.length > maxProducts) {
    return { error: `Informe de 1 a ${maxProducts} produtos.` };
  }
  const products = values.map(normalizeProduct);
  const skus = new Set();
  for (const product of products) {
    if (!product.name || !product.variants.length) return { error: "Cada produto precisa de nome e ao menos uma variação." };
    for (const variant of product.variants) {
      if (!variant.sku) return { error: `Informe o SKU de ${product.name}.` };
      if (skus.has(variant.sku)) return { error: `O SKU ${variant.sku} está repetido no envio.` };
      skus.add(variant.sku);
    }
  }
  return { products };
}

export function normalizeMovementLines(values, { direction = 1, maxLines = 500 } = {}) {
  if (!Array.isArray(values) || !values.length || values.length > maxLines) return null;
  const lines = values.map((line) => ({
    variantId: text(line.variantId, 36),
    quantity: Math.abs(number(line.quantity)),
    delta: Math.abs(number(line.quantity)) * direction,
    unitCost: Math.max(0, number(line.unitCost)),
    unitPrice: Math.max(0, number(line.unitPrice)),
    lotCode: text(line.lotCode, 80),
    expiresOn: isoDate(line.expiresOn),
  }));
  return lines.every((line) => line.variantId && line.quantity > 0) ? lines : null;
}
