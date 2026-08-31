// Resumos operacionais puros: nenhuma função altera os registros recebidos.
const amount = (value) => Number(value) || 0;
const isPastDue = (date, status, settledStatuses, referenceDate) =>
  Boolean(date) && date < referenceDate && !settledStatuses.includes(status);

export function summarizeAccounts(accounts = [], referenceDate = new Date().toISOString().slice(0, 10)) {
  return accounts.reduce(
    (summary, account) => {
      const value = amount(account.amount);
      const settled = ["pago", "recebido"].includes(account.status);
      if (account.type === "receber" && !settled) summary.receivable += value;
      if (account.type === "pagar" && !settled) summary.payable += value;
      if (isPastDue(account.dueDate, account.status, ["pago", "recebido"], referenceDate)) {
        summary.overdue += 1;
      }
      return summary;
    },
    { receivable: 0, payable: 0, overdue: 0 },
  );
}

export function summarizeInventory(state = {}, referenceDate = new Date().toISOString().slice(0, 10)) {
  const products = state.products || [];
  const deliveries = state.deliveries || [];
  return {
    skus: products.filter((product) => product.name || product.sku).length,
    units: products.reduce((sum, product) => sum + amount(product.quantity), 0),
    value: products.reduce(
      (sum, product) => sum + amount(product.quantity) * amount(product.unitCost),
      0,
    ),
    lowStock: products.filter(
      (product) => (product.name || product.sku) && amount(product.quantity) <= amount(product.minimum),
    ).length,
    openDeliveries: deliveries.filter(
      (delivery) => delivery.description && !["entregue", "cancelada"].includes(delivery.status),
    ).length,
    lateDeliveries: deliveries.filter(
      (delivery) =>
        delivery.description &&
        isPastDue(delivery.date, delivery.status, ["entregue", "cancelada"], referenceDate),
    ).length,
  };
}

export function summarizeOrders(orders = [], referenceDate = new Date().toISOString().slice(0, 10)) {
  return orders.reduce(
    (summary, order) => {
      if (!order.partner && !order.number && !amount(order.amount)) return summary;
      if (order.status !== "cancelado") {
        if (order.type === "venda") summary.sales += amount(order.amount);
        if (order.type === "compra") summary.purchases += amount(order.amount);
      }
      if (order.type === "compra" && order.partner) summary.suppliers.add(order.partner.trim().toLowerCase());
      if (isPastDue(order.dueDate, order.status, ["concluido", "cancelado"], referenceDate)) {
        summary.overdue += 1;
      }
      summary.balance = summary.sales - summary.purchases;
      return summary;
    },
    { sales: 0, purchases: 0, balance: 0, overdue: 0, suppliers: new Set() },
  );
}

export function ordersFromCashEntries(entries = [], existingOrders = []) {
  const existingKeys = new Set(existingOrders.map((order) => order.sourceCashKey).filter(Boolean));
  return entries.flatMap((entry, index) => {
    const value = Math.abs(amount(entry.amount));
    if (!value || !entry.description) return [];
    const key = `${entry.date}|${entry.type}|${value.toFixed(2)}|${entry.description}`;
    if (existingKeys.has(key)) return [];
    return [{
      id: `cash-${index}-${key}`,
      type: entry.type === "entrada" ? "venda" : "compra",
      number: `EXT-${String(index + 1).padStart(3, "0")}`,
      partner: entry.description,
      contact: "", description: "", sku: "", quantity: "",
      date: entry.date, dueDate: entry.date, amount: String(value), status: "rascunho",
      source: "extrato", sourceCashKey: key,
    }];
  });
}

function normalizedWords(value) {
  return new Set(String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3));
}

function sharedWordCount(left, right) {
  const leftWords = normalizedWords(left);
  const rightWords = normalizedWords(right);
  return [...leftWords].filter((word) => rightWords.has(word)).length;
}

function dateDistance(left, right) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(left || "") || !/^\d{4}-\d{2}-\d{2}$/.test(right || "")) return null;
  return Math.abs((Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / 86_400_000);
}

/**
 * Sugere vínculos um-a-um por direção e valor exato. Datas e palavras apenas
 * ordenam candidatos; a função nunca altera status nem movimentações.
 */
export function suggestFinancialReconciliations(entries = [], accounts = [], orders = []) {
  const candidates = [];
  entries.forEach((entry, entryIndex) => {
    const entryAmount = Math.abs(amount(entry.amount));
    if (!entryAmount || !entry.description || entry.sourceCommitmentId || entry.sourceOrderKey) return;
    accounts.forEach((account, accountIndex) => {
      if (["pago", "recebido"].includes(account.status)) return;
      const compatible = (entry.type === "entrada" && account.type === "receber")
        || (entry.type === "saida" && account.type === "pagar");
      if (!compatible || Math.abs(entryAmount - Math.abs(amount(account.amount))) >= 0.01) return;
      const distance = dateDistance(entry.date, account.dueDate);
      const words = sharedWordCount(entry.description, `${account.party || ""} ${account.description || ""}`);
      const score = 60 + (distance === null ? 0 : distance <= 3 ? 25 : distance <= 10 ? 15 : 0) + Math.min(words * 5, 15);
      candidates.push({ entryIndex, targetIndex: accountIndex, targetType: "commitment", score, distance, words });
    });
    orders.forEach((order, orderIndex) => {
      if (order.status === "cancelado" || order.financePostedAt) return;
      const compatible = (entry.type === "entrada" && order.type === "venda")
        || (entry.type === "saida" && order.type === "compra");
      if (!compatible || Math.abs(entryAmount - Math.abs(amount(order.amount))) >= 0.01) return;
      const distance = dateDistance(entry.date, order.date || order.dueDate);
      const words = sharedWordCount(entry.description, `${order.partner || ""} ${order.number || ""} ${order.description || ""}`);
      const score = 55 + (distance === null ? 0 : distance <= 3 ? 25 : distance <= 10 ? 15 : 0) + Math.min(words * 5, 15);
      candidates.push({ entryIndex, targetIndex: orderIndex, targetType: "order", score, distance, words });
    });
  });
  const usedEntries = new Set(); const usedTargets = new Set(); const suggestions = [];
  candidates.sort((left, right) => right.score - left.score || left.entryIndex - right.entryIndex || left.targetIndex - right.targetIndex);
  candidates.forEach((candidate) => {
    const targetKey = `${candidate.targetType}:${candidate.targetIndex}`;
    if (usedEntries.has(candidate.entryIndex) || usedTargets.has(targetKey)) return;
    usedEntries.add(candidate.entryIndex); usedTargets.add(targetKey);
    const entry = entries[candidate.entryIndex];
    const target = candidate.targetType === "commitment" ? accounts[candidate.targetIndex] : orders[candidate.targetIndex];
    const targetLabel = candidate.targetType === "commitment"
      ? target.party || target.description || "Conta pendente"
      : `${target.type === "venda" ? "Venda" : "Compra"} ${target.number || target.partner || "sem referência"}`;
    suggestions.push({
      ...candidate,
      entryId: entry.id || "",
      targetId: target.id || "",
      entryLabel: entry.description,
      targetLabel,
      amount: Math.abs(amount(entry.amount)),
      confidence: candidate.score >= 85 ? "alta" : "revisar",
      reason: ["mesmo tipo e valor", candidate.distance !== null && candidate.distance <= 10 ? `datas a ${candidate.distance} dia(s)` : "", candidate.words ? "descrição semelhante" : ""].filter(Boolean).join("; "),
    });
  });
  return suggestions;
}
