// Resumos operacionais puros: nenhuma função altera os registros recebidos.
const amount = (value) => Number(value) || 0;
const isPastDue = (date, status, settledStatuses, referenceDate) =>
  Boolean(date) && date < referenceDate && !settledStatuses.includes(status);

export function summarizeAccounts(accounts = [], referenceDate = new Date().toISOString().slice(0, 10)) {
  return accounts.reduce(
    (summary, account) => {
      const values = commitmentAmounts(account);
      const settled = values.balance <= 0.009 || ["pago", "recebido"].includes(account.status);
      if (account.type === "receber" && !settled) summary.receivable += values.balance;
      if (account.type === "pagar" && !settled) summary.payable += values.balance;
      if (!settled && values.paid > 0) summary.partial += 1;
      if (isPastDue(account.dueDate, account.status, ["pago", "recebido"], referenceDate)) {
        summary.overdue += 1;
        summary.overdueAmount += values.balance;
      }
      return summary;
    },
    { receivable: 0, payable: 0, overdue: 0, overdueAmount: 0, partial: 0 },
  );
}

export function commitmentAmounts(account = {}) {
  const base = Math.max(0, amount(account.amount));
  const interest = Math.max(0, amount(account.interestAmount));
  const penalty = Math.max(0, amount(account.penaltyAmount));
  const discount = Math.max(0, amount(account.discountAmount));
  const total = Math.max(0, base + interest + penalty - discount);
  const paid = Math.min(total, Math.max(0, amount(account.paidAmount)));
  return { base, interest, penalty, discount, total, paid, balance: Math.max(0, total - paid) };
}

function dateKeyToEpoch(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? Date.parse(`${value}T00:00:00Z`) : null;
}

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function financialOutlook(accounts = [], entries = [], referenceDate = localDateKey()) {
  const reference = dateKeyToEpoch(referenceDate);
  const currentBalance = entries.reduce((sum, entry) => sum + (entry.type === "saida" ? -1 : 1) * amount(entry.amount), 0);
  const open = accounts.flatMap((account, index) => {
    const dueAt = dateKeyToEpoch(account.dueDate);
    const values = commitmentAmounts(account);
    if (dueAt === null || reference === null || values.balance <= 0.009 || ["pago", "recebido"].includes(account.status)) return [];
    const daysUntil = Math.round((dueAt - reference) / 86_400_000);
    return [{
      id: account.id || `commitment-${index}`,
      title: account.description || account.party || (account.type === "receber" ? "Recebimento" : "Pagamento"),
      type: account.type === "receber" ? "receber" : "pagar",
      dueDate: account.dueDate,
      balance: values.balance,
      daysUntil,
      state: daysUntil < 0 ? "overdue" : daysUntil === 0 ? "today" : daysUntil <= 7 ? "soon" : "future",
    }];
  }).sort((left, right) => left.dueDate.localeCompare(right.dueDate) || left.title.localeCompare(right.title));
  const horizons = [7, 30, 90].map((days) => {
    const included = open.filter((item) => item.daysUntil <= days);
    const incoming = included.filter((item) => item.type === "receber").reduce((sum, item) => sum + item.balance, 0);
    const outgoing = included.filter((item) => item.type === "pagar").reduce((sum, item) => sum + item.balance, 0);
    return { days, incoming, outgoing, projected: currentBalance + incoming - outgoing };
  });
  return {
    currentBalance,
    horizons,
    alerts: {
      overdue: open.filter((item) => item.state === "overdue").length,
      today: open.filter((item) => item.state === "today").length,
      next7Days: open.filter((item) => item.state === "soon").length,
    },
    calendar: open,
  };
}

function shiftedDate(value, frequency, offset) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return "";
  const [year, month, day] = value.split("-").map(Number);
  if (frequency === "weekly") {
    const date = new Date(Date.UTC(year, month - 1, day + offset * 7));
    return date.toISOString().slice(0, 10);
  }
  if (frequency === "yearly") {
    const lastDay = new Date(Date.UTC(year + offset, month, 0)).getUTCDate();
    return `${year + offset}-${String(month).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
  }
  const targetMonth = month - 1 + offset;
  const targetYear = year + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  return `${targetYear}-${String(normalizedMonth + 1).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

/** Gera uma série finita; nenhuma parcela é paga ou criada silenciosamente. */
export function expandCommitmentSeries(account, { count, frequency = "monthly", idFactory = (index) => `installment-${index + 1}` } = {}) {
  const installments = Math.min(60, Math.max(2, Math.trunc(Number(count) || 0)));
  if (!account?.dueDate || !["weekly", "monthly", "yearly"].includes(frequency)) return [];
  const seriesId = account.seriesId || idFactory("series");
  return Array.from({ length: installments }, (_, index) => ({
    ...account,
    id: index === 0 && account.id ? account.id : idFactory(index),
    dueDate: shiftedDate(account.dueDate, frequency, index),
    status: "pendente",
    paidAmount: 0,
    postedAt: "",
    seriesId,
    recurrence: frequency,
    installmentNumber: index + 1,
    installmentCount: installments,
  }));
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
      if (!compatible || Math.abs(entryAmount - commitmentAmounts(account).balance) >= 0.01) return;
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
