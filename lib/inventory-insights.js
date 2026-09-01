const DAY_MS = 86_400_000;

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildInventoryInsights(products, analyticsRows = [], now = new Date()) {
  const analyticsByVariant = new Map(analyticsRows.map((row) => [row.variant_id, row]));
  const items = products.flatMap((product) => product.variants.map((variant) => {
    const analytics = analyticsByVariant.get(variant.id) || {};
    const averageUnitCost = numeric(analytics.average_unit_cost) || numeric(variant.unitCost);
    const saleRevenue = numeric(analytics.sale_revenue);
    const lastSaleAt = analytics.last_sale_at || null;
    const createdAt = analytics.created_at || null;
    const activityAt = lastSaleAt || createdAt;
    const daysWithoutSale = activityAt
      ? Math.max(0, Math.floor((now.getTime() - new Date(activityAt).getTime()) / DAY_MS))
      : 0;
    const reorderQuantity = Math.max(0, numeric(variant.minimumQuantity) - numeric(variant.quantity));
    return {
      variantId: variant.id,
      productName: product.name,
      variantName: variant.name,
      sku: variant.sku,
      unit: product.unit,
      quantity: numeric(variant.quantity),
      minimumQuantity: numeric(variant.minimumQuantity),
      averageUnitCost,
      stockValue: numeric(variant.quantity) * averageUnitCost,
      saleRevenue,
      lastSaleAt,
      daysWithoutSale,
      idle: numeric(variant.quantity) > 0 && daysWithoutSale >= 90,
      reorderQuantity,
      abcClass: "C",
    };
  }));

  const ranked = [...items].sort((a, b) => b.saleRevenue - a.saleRevenue || a.sku.localeCompare(b.sku));
  const totalRevenue = ranked.reduce((sum, item) => sum + item.saleRevenue, 0);
  let cumulativeRevenue = 0;
  for (const item of ranked) {
    const shareBefore = totalRevenue > 0 ? cumulativeRevenue / totalRevenue : 1;
    item.abcClass = totalRevenue === 0 ? "C" : shareBefore < 0.8 ? "A" : shareBefore < 0.95 ? "B" : "C";
    cumulativeRevenue += item.saleRevenue;
  }

  return {
    items: ranked,
    summary: {
      totalRevenue,
      averageCostStockValue: items.reduce((sum, item) => sum + item.stockValue, 0),
      idleItems: items.filter((item) => item.idle).length,
      idleStockValue: items.filter((item) => item.idle).reduce((sum, item) => sum + item.stockValue, 0),
      reorderItems: items.filter((item) => item.reorderQuantity > 0).length,
      reorderUnits: items.reduce((sum, item) => sum + item.reorderQuantity, 0),
    },
  };
}
