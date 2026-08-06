import { zipSync, strToU8 } from "fflate";
import { calculateAmortization } from "./finance-calculations.js";

const LABELS = {
  period: "Período", date: "Data", flow: "Fluxo", discounted: "Valor presente",
  accumulated: "Acumulado", openingBalance: "Saldo inicial", payment: "Prestação",
  interest: "Juros", amortization: "Amortização", balance: "Saldo final",
  category: "Categoria", description: "Descrição", type: "Tipo", amount: "Valor",
  name: "Despesa", totalCost: "Despesas totais", unitCost: "Custo unitário",
  unitProfit: "Lucro unitário", unitPrice: "Preço unitário", expectedRevenue: "Faturamento esperado",
  sku: "SKU / código", quantity: "Quantidade", minimum: "Estoque mínimo", location: "Localização",
  number: "Pedido", partner: "Cliente / fornecedor", status: "Status", system: "Sistema",
  principal: "Principal financiado", interestRate: "Taxa de juros (%)", periods: "Parcelas",
  totalInterest: "Total de juros", totalPaid: "Total pago", metric: "Indicador", value: "Valor",
  product: "Produto", marginRate: "Margem de lucro",
};

const CURRENCY_KEYS = new Set([
  "flow", "discounted", "accumulated", "openingBalance", "payment", "interest",
  "amortization", "balance", "amount", "totalCost", "unitCost", "unitProfit",
  "unitPrice", "expectedRevenue",
  "principal", "totalInterest", "totalPaid",
]);
const PERCENTAGE_KEYS = new Set(["interestRate", "marginRate"]);
const INTEGER_KEYS = new Set(["period", "periods", "quantity", "minimum"]);

function xml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function columnName(index) {
  let value = index + 1;
  let name = "";
  while (value) {
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function excelDate(value) {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(date.getTime()) ? date.getTime() / 86_400_000 + 25569 : null;
}

function cell(reference, value, style = 0, type = null) {
  if (value === null || value === undefined || value === "") return `<c r="${reference}" s="${style}"/>`;
  if (type === "number" && Number.isFinite(Number(value))) {
    return `<c r="${reference}" s="${style}"><v>${Number(value)}</v></c>`;
  }
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

function formulaCell(reference, formula, value, style = 6) {
  const cached = style === 6 ? Math.round((Number(value) || 0) * 100) / 100 : Number(value) || 0;
  return `<c r="${reference}" s="${style}"><f>${xml(formula)}</f><v>${cached}</v></c>`;
}

function sectionTotals(rows, keys, startRow, endRow) {
  const column = (key) => columnName(keys.indexOf(key));
  const totals = [];
  if (keys.includes("flow")) {
    const range = `${column("flow")}${startRow}:${column("flow")}${endRow}`;
    const value = -rows.reduce((sum, row) => sum + Math.abs(Math.min(0, Number(row.flow) || 0)), 0);
    totals.push({ label: "Total gasto", key: "flow", column: column("flow"), formula: `ROUND(SUMIF(${range},"<0",${range}),2)`, value });
  }
  if (keys.includes("payment")) {
    const range = `${column("payment")}${startRow}:${column("payment")}${endRow}`;
    const value = -rows.reduce((sum, row) => sum + (Number(row.payment) || 0), 0);
    totals.push({ label: "Total pago", key: "payment", column: column("payment"), formula: `ROUND(SUM(${range}),2)`, value });
  }
  if (keys.includes("interest")) {
    const range = `${column("interest")}${startRow}:${column("interest")}${endRow}`;
    const value = -rows.reduce((sum, row) => sum + (Number(row.interest) || 0), 0);
    totals.push({ label: "Total de juros", key: "interest", column: column("interest"), formula: `ROUND(SUM(${range}),2)`, value });
  }
  if (keys.includes("amount")) {
    const amountRange = `${column("amount")}${startRow}:${column("amount")}${endRow}`;
    const expenseTypes = new Set(["saida", "compra", "pagar"]);
    const value = -rows.reduce(
      (sum, row) => sum + (keys.includes("type") && !expenseTypes.has(row.type) ? 0 : Number(row.amount) || 0),
      0,
    );
    const formula = keys.includes("type")
      ? `ROUND(SUM(SUMIF(${column("type")}${startRow}:${column("type")}${endRow},{"saida","compra","pagar"},${amountRange})),2)`
      : `ROUND(SUM(${amountRange}),2)`;
    totals.push({ label: "Total gasto", key: "amount", column: column("amount"), formula, value });
  }
  if (keys.includes("quantity")) {
    const range = `${column("quantity")}${startRow}:${column("quantity")}${endRow}`;
    const value = rows.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);
    totals.push({ label: "Quantidade total de itens", key: "quantity", column: column("quantity"), formula: `SUM(${range})`, value });
  }
  if (keys.includes("totalCost")) {
    const range = `${column("totalCost")}${startRow}:${column("totalCost")}${endRow}`;
    const value = rows.reduce((sum, row) => sum + (Number(row.totalCost) || 0), 0);
    totals.push({ label: "Valor total", key: "totalCost", column: column("totalCost"), formula: `ROUND(SUM(${range}),2)`, value });
  }
  return totals;
}

function numberStyle(key) {
  if (CURRENCY_KEYS.has(key)) return 3;
  if (PERCENTAGE_KEYS.has(key)) return 7;
  if (INTEGER_KEYS.has(key)) return 8;
  return 0;
}

// Valores financeiros continuam armazenados como magnitude positiva no banco.
// Na exportação, o sinal passa a representar a direção real do dinheiro.
function signedExportNumber(key, value, row = {}) {
  const numeric = Number(value) || 0;
  if (key === "amount") {
    if (row.type === "saida" || row.type === "compra" || row.type === "pagar") return -Math.abs(numeric);
    if (row.type === "entrada" || row.type === "venda" || row.type === "receber") return Math.abs(numeric);
  }
  if (key === "payment" || key === "interest" || key === "totalInterest" || key === "totalPaid") {
    return -Math.abs(numeric);
  }
  return numeric;
}

function financingEntries(payload, source) {
  const candidates = [
    ...(Array.isArray(payload.financialTables) ? payload.financialTables : []),
    ...(Array.isArray(source.savedFinancings) ? source.savedFinancings : []),
    payload.financialTable,
  ].filter((entry) => entry?.state?.form);
  const seen = new Set();
  return candidates.filter((entry) => {
    const key = entry.id || JSON.stringify(entry.state || entry.result?.rows?.[0] || {});
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((entry) => ({
    ...entry,
    result: entry.result?.rows?.length
      ? entry.result
      : calculateAmortization({ ...entry.state.form, system: entry.state.system }),
  })).filter((entry) => entry.result.rows.length);
}

function reportSections(item) {
  const payload = item.payload || {};
  const source = payload.workspace || payload;
  const sections = [];
  const primary = payload.table || payload.entries;
  const financings = financingEntries(payload, source);
  if (Array.isArray(primary) && primary.length && !(item.calculation_type === "tabela-financeira" && financings.length)) {
    sections.push({ title: "Dados e memória do cálculo", rows: primary });
  }
  if (financings.length) {
    sections.push({
      title: "Resumo dos financiamentos",
      rows: financings.map((entry, index) => ({
        description: entry.state?.form?.description || `Financiamento ${index + 1}`,
        system: entry.state?.system || "",
        principal: Number(entry.state?.form?.principal) || 0,
        interestRate: Number(entry.state?.form?.rate) || 0,
        periods: Number(entry.state?.form?.periods) || 0,
        totalInterest: Number(entry.result?.totalInterest) || 0,
        totalPaid: Number(entry.result?.totalPaid) || 0,
      })),
    });
    financings.forEach((entry, index) => sections.push({
      title: `Memória do financiamento ${index + 1} - ${entry.state?.form?.description || entry.state?.system || "Sem finalidade informada"}`,
      rows: entry.result.rows,
    }));
  }
  const pricingState = payload.pricingState || source.pricingState;
  const pricingResult = payload.pricingResult;
  const expenses = (pricingState?.expenses || []).map((expense) => ({ name: expense.name, amount: Number(expense.amount) || 0 }));
  if (expenses.length) sections.push({ title: "Despesas do produto", rows: expenses });
  if (pricingResult) {
    // Consolida identificação, custo, margem e preço em uma única tabela auditável.
    sections.push({
      title: "Custo e preço do produto",
      rows: [{
        product: pricingState?.productName || "Produto não informado",
        sku: pricingState?.sku || "",
        quantity: Number(pricingResult.quantity) || 0,
        totalCost: Number(pricingResult.totalCost) || 0,
        unitCost: Number(pricingResult.unitCost) || 0,
        marginRate: Number(pricingResult.marginRate) || 0,
        unitPrice: Number(pricingResult.unitPrice) || 0,
        unitProfit: Number(pricingResult.unitProfit) || 0,
        expectedRevenue: Number(pricingResult.expectedRevenue) || 0,
      }],
    });
  }
  const products = (source.inventoryState?.products || [])
    .filter((product) => product.name || product.sku || Number(product.quantity) || Number(product.unitCost))
    .map((product) => ({
      product: product.name, sku: product.sku, quantity: Number(product.quantity) || 0,
      minimum: Number(product.minimum) || 0, unitCost: Number(product.unitCost) || 0,
      totalCost: (Number(product.quantity) || 0) * (Number(product.unitCost) || 0), location: product.location,
    }));
  if (products.length) sections.push({ title: "Itens de estoque", rows: products });
  const orders = (source.commerceOrders || []).filter((order) => order.number || order.partner || order.sku || Number(order.amount));
  if (orders.length) sections.push({ title: "Vendas e compras", rows: orders.map((order) => ({
    type: order.type, number: order.number, partner: order.partner, sku: order.sku,
    quantity: Number(order.quantity) || 0, date: order.date, amount: Number(order.amount) || 0, status: order.status,
  })) });
  return sections;
}

function reportSummary(item) {
  const payload = item.payload || {};
  const source = payload.workspace || payload;
  const financings = financingEntries(payload, source);
  const products = source.inventoryState?.products || [];
  const cashRows = source.cashEntries || payload.entries || [];
  const cashSpent = cashRows.reduce((sum, row) => sum + (row.type === "saida" ? Number(row.amount) || 0 : 0), 0);
  const investmentSpent = (payload.table || []).reduce((sum, row) => sum + Math.abs(Math.min(0, Number(row.flow) || 0)), 0);
  const purchases = (source.commerceOrders || []).reduce((sum, row) => sum + (row.type === "compra" && row.status !== "cancelado" ? Number(row.amount) || 0 : 0), 0);
  const pricingSpent = (source.pricingState?.expenses || payload.pricingState?.expenses || []).reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const pricingResult = payload.pricingResult || source.pricingResult;
  const totalSpent = cashSpent > 0 ? cashSpent : investmentSpent + purchases + pricingSpent;
  const summary = [
    { metric: "Quantidade de itens em estoque", value: products.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0), format: "integer" },
    { metric: "Valor estimado do estoque", value: products.reduce((sum, row) => sum + (Number(row.quantity) || 0) * (Number(row.unitCost) || 0), 0), format: "currency" },
    { metric: "Total gasto registrado", value: -Math.abs(totalSpent), format: "currency" },
    { metric: "Principal total financiado", value: financings.reduce((sum, entry) => sum + (Number(entry.state?.form?.principal) || 0), 0), format: "currency" },
    { metric: "Total de juros", value: -Math.abs(financings.reduce((sum, entry) => sum + (Number(entry.result?.totalInterest) || 0), 0)), format: "currency" },
    { metric: "Total pago em financiamentos", value: -Math.abs(financings.reduce((sum, entry) => sum + (Number(entry.result?.totalPaid) || 0), 0)), format: "currency" },
  ];
  // Custos de produto só entram no resumo quando houve cálculo de preço.
  if (pricingResult) {
    summary.splice(2, 0,
      { metric: "Custo total do produto calculado", value: Number(pricingResult.totalCost) || 0, format: "currency" },
      { metric: "Custo unitário do produto", value: Number(pricingResult.unitCost) || 0, format: "currency" },
    );
  }
  return summary;
}

function worksheetXml(item) {
  const rows = [];
  const merges = [];
  let rowNumber = 1;
  let maxColumns = 2;
  let firstFilter = null;
  const addRow = (cells, height = null) => {
    rows.push(`<row r="${rowNumber}"${height ? ` ht="${height}" customHeight="1"` : ""}>${cells.join("")}</row>`);
    rowNumber += 1;
  };

  addRow([cell("A1", item.title, 1)], 28);
  merges.push("A1:G1");
  addRow([cell("A2", "Tipo", 5), cell("B2", item.calculation_type)]);
  addRow([cell("A3", "Criado em", 5), cell("B3", new Date(item.created_at).toLocaleString("pt-BR"))]);
  rowNumber += 1;

  for (const section of reportSections(item)) {
    const keys = Object.keys(section.rows[0]);
    maxColumns = Math.max(maxColumns, keys.length);
    const titleRow = rowNumber;
    addRow([cell(`A${rowNumber}`, section.title, 1)], 24);
    merges.push(`A${titleRow}:${columnName(keys.length - 1)}${titleRow}`);
    const headerRow = rowNumber;
    addRow(keys.map((key, index) => cell(`${columnName(index)}${rowNumber}`, LABELS[key] || key, 2)), 22);
    const dataStartRow = rowNumber;
    for (const data of section.rows) {
      const currentRow = rowNumber;
      addRow(keys.map((key, index) => {
        const ref = `${columnName(index)}${currentRow}`;
        if (key === "date") {
          const serial = excelDate(data[key]);
          return serial === null ? cell(ref, data[key]) : cell(ref, serial, 4, "number");
        }
        if (typeof data[key] === "number" || CURRENCY_KEYS.has(key) || PERCENTAGE_KEYS.has(key) || INTEGER_KEYS.has(key)) {
          const numeric = signedExportNumber(key, data[key], data);
          const displayed = CURRENCY_KEYS.has(key) ? Math.round(numeric * 100) / 100 : numeric;
          return cell(ref, displayed, numberStyle(key), "number");
        }
        return cell(ref, data[key]);
      }));
    }
    const dataEndRow = rowNumber - 1;
    const totals = sectionTotals(section.rows, keys, dataStartRow, dataEndRow);
    for (const total of totals) {
      const totalRow = rowNumber;
      addRow([
        cell(`A${totalRow}`, total.label, 6),
        formulaCell(`${total.column}${totalRow}`, total.formula, total.value, total.key === "quantity" ? 8 : 6),
      ], 22);
    }
    rows.push(`<row r="${rowNumber}"/>`);
    rowNumber += 1;
    // Cada tabela recebe filtro próprio quando não se sobrepõe à próxima seção.
    if (!firstFilter) firstFilter = `A${headerRow}:${columnName(keys.length - 1)}${dataEndRow}`;
  }

  const summary = reportSummary(item);
  const summaryTitleRow = rowNumber;
  addRow([cell(`A${rowNumber}`, "Resumo final", 1)], 24);
  merges.push(`A${summaryTitleRow}:B${summaryTitleRow}`);
  addRow([cell(`A${rowNumber}`, "Indicador", 2), cell(`B${rowNumber}`, "Total", 2)], 22);
  for (const entry of summary) {
    const currentRow = rowNumber;
    addRow([
      cell(`A${currentRow}`, entry.metric, 5),
      cell(`B${currentRow}`, entry.format === "currency" ? Math.round(entry.value * 100) / 100 : entry.value, entry.format === "currency" ? 6 : 8, "number"),
    ], 22);
  }
  const noteRow = rowNumber;
  addRow([cell(`A${noteRow}`, "Critério: quando há saídas no fluxo de caixa, elas são usadas como fonte principal do total gasto para reduzir duplicidades. O valor do estoque e o principal financiado são apresentados separadamente.", 9)], 34);
  merges.push(`A${noteRow}:${columnName(Math.max(1, maxColumns - 1))}${noteRow}`);

  const widths = Array.from({ length: maxColumns }, (_, index) => {
    const width = index === 0 ? 34 : index === 1 ? 26 : 20;
    return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`;
  }).join("");
  const filter = firstFilter;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>${widths}</cols><sheetData>${rows.join("")}</sheetData>
  ${filter ? `<autoFilter ref="${filter}"/>` : ""}
  ${merges.length ? `<mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>` : ""}
  <pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
</worksheet>`;
}

export function historyXlsx(item) {
  // XLSX é um conjunto de arquivos OpenXML compactados; usar tipos reais evita
  // problemas de acentuação, separador decimal e datas comuns em arquivos CSV.
  const files = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="CandTech" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="R$ #,##0.00;[Red]-R$ #,##0.00"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/><numFmt numFmtId="166" formatCode="0.00&quot;%&quot;"/></numFmts><fonts count="4"><font><sz val="10"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="14"/><name val="Aptos Display"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Aptos"/></font><font><b/><color rgb="FF312E81"/><sz val="10"/><name val="Aptos"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF312E81"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF4F46E5"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="3"><border/><border><bottom style="thin"><color rgb="FFD7DCE5"/></bottom></border><border><top style="medium"><color rgb="FF4F46E5"/></top></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="10"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right"/></xf><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1"><alignment horizontal="left"/></xf><xf numFmtId="164" fontId="3" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1" applyNumberFormat="1"><alignment horizontal="right"/></xf><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="right"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`),
    "xl/worksheets/sheet1.xml": strToU8(worksheetXml(item)),
  };
  return Buffer.from(zipSync(files, { level: 6 }));
}

export function historyXlsxFilename(item) {
  return `historico-${item.id}.xlsx`;
}
