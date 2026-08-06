const HEADER_LABELS = {
  period: "Período",
  date: "Data",
  flow: "Fluxo",
  discounted: "Valor presente",
  accumulated: "Acumulado",
  openingBalance: "Saldo inicial",
  payment: "Prestação",
  interest: "Juros",
  amortization: "Amortização",
  balance: "Saldo final",
  item: "Item",
  valor: "Valor",
  name: "Despesa",
  amount: "Valor",
  totalCost: "Despesas totais",
  unitCost: "Custo unitário",
  unitProfit: "Lucro unitário",
  unitPrice: "Preço unitário",
  expectedRevenue: "Faturamento esperado",
  product: "Produto",
  sku: "SKU / código",
  quantity: "Quantidade",
  marginRate: "Margem de lucro (%)",
};

function excelCell(item) {
  if (item === null || item === undefined) return "";
  // Números ficam sem aspas e com vírgula decimal para o Excel pt-BR.
  if (typeof item === "number" && Number.isFinite(item)) {
    return String(item).replace(".", ",");
  }
  let text = String(item);
  // Impede que um texto controlado pelo usuário seja executado como fórmula.
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

const csvLine = (cells) => cells.map(excelCell).join(";");

function totalSpent(rows) {
  if (!rows.length) return null;
  const keys = Object.keys(rows[0]);
  if (keys.includes("flow")) {
    return rows.reduce((sum, row) => sum + Math.abs(Math.min(0, Number(row.flow) || 0)), 0);
  }
  if (keys.includes("payment")) {
    return rows.reduce((sum, row) => sum + (Number(row.payment) || 0), 0);
  }
  if (keys.includes("amount")) {
    const expenseTypes = new Set(["saida", "compra", "pagar"]);
    return rows.reduce(
      (sum, row) => sum + (keys.includes("type") && !expenseTypes.has(row.type) ? 0 : Number(row.amount) || 0),
      0,
    );
  }
  return null;
}

// O tipo define o sinal contábil; o valor salvo permanece positivo para evitar
// duplicar a regra em todos os cálculos internos.
function signedExportValue(header, value, row) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  if (header === "amount") {
    if (["saida", "compra", "pagar"].includes(row.type)) return -Math.abs(numeric);
    if (["entrada", "venda", "receber"].includes(row.type)) return Math.abs(numeric);
  }
  if (["payment", "interest", "totalInterest", "totalPaid"].includes(header)) return -Math.abs(numeric);
  return value;
}

function tableSection(title, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const headers = Object.keys(rows[0]);
  const spent = totalSpent(rows);
  return [
    [title],
    headers.map((header) => HEADER_LABELS[header] || header),
    ...rows.map((row) => headers.map((header) => signedExportValue(header, row[header], row))),
    ...(spent === null ? [] : [["Total gasto", -Math.abs(spent)]]),
    [],
  ];
}

export function historyCsv(item) {
  const calculationRows = item.payload.table || item.payload.entries || [];
  const financing = item.payload.financialTable;
  const pricingExpenses = (item.payload.pricingState?.expenses || []).map((expense) => ({
    name: expense.name,
    amount: Number(expense.amount) || 0,
  }));
  const pricingState = item.payload.pricingState;
  const pricingResult = item.payload.pricingResult;
  const pricingTable = pricingResult ? [{
    product: pricingState?.productName || "Produto não informado",
    sku: pricingState?.sku || "",
    quantity: Number(pricingResult.quantity) || 0,
    totalCost: Number(pricingResult.totalCost) || 0,
    unitCost: Number(pricingResult.unitCost) || 0,
    marginRate: (Number(pricingResult.marginRate) || 0) * 100,
    unitPrice: Number(pricingResult.unitPrice) || 0,
    unitProfit: Number(pricingResult.unitProfit) || 0,
    expectedRevenue: Number(pricingResult.expectedRevenue) || 0,
  }] : [];
  const lines = [
    ["Título", item.title],
    ["Tipo", item.calculation_type],
    ["Criado em", item.created_at],
    [],
    ...tableSection("Fluxo e memória do cálculo", calculationRows),
    ...tableSection(
      financing && item.calculation_type !== "tabela-financeira"
        ? `Tabela financeira - ${financing.state?.system || ""}`
        : "",
      item.calculation_type !== "tabela-financeira" ? financing?.result?.rows : [],
    ),
    ...tableSection("Despesas do produto", pricingExpenses),
    ...tableSection("Custo e preço do produto", pricingTable),
  ];
  // A primeira linha orienta o Excel mesmo se o Windows usar outro separador regional.
  return ["sep=;", ...lines.map(csvLine)].join("\r\n");
}

export function historyCsvFilename(item) {
  return `historico-${item.id}.csv`;
}
