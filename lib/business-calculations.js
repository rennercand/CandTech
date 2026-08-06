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
      document: "", contact: "", description: "", sku: "", quantity: "",
      date: entry.date, dueDate: entry.date, amount: String(value), status: "rascunho",
      source: "extrato", sourceCashKey: key,
    }];
  });
}
