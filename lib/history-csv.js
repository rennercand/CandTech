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

function tableSection(title, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const headers = Object.keys(rows[0]);
  return [
    [title],
    headers.map((header) => HEADER_LABELS[header] || header),
    ...rows.map((row) => headers.map((header) => row[header])),
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
    ...tableSection("Resultado da precificação", item.payload.pricingResult ? [item.payload.pricingResult] : []),
  ];
  // A primeira linha orienta o Excel mesmo se o Windows usar outro separador regional.
  return ["sep=;", ...lines.map(csvLine)].join("\r\n");
}

export function historyCsvFilename(item) {
  return `historico-${item.id}.csv`;
}
