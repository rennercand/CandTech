import PDFDocument from "pdfkit";

const LABELS = {
  period: "Período", date: "Data", flow: "Fluxo", discounted: "Valor presente",
  accumulated: "Acumulado", openingBalance: "Saldo inicial", payment: "Prestação",
  interest: "Juros", amortization: "Amortização", balance: "Saldo final",
  category: "Categoria", description: "Descrição", type: "Tipo", amount: "Valor",
  name: "Despesa", totalCost: "Despesas totais", unitCost: "Custo unitário",
  unitProfit: "Lucro unitário", unitPrice: "Preço unitário",
};

const currencyKeys = new Set([
  "flow", "discounted", "accumulated", "openingBalance", "payment", "interest",
  "amortization", "balance", "amount", "totalCost", "unitCost", "unitProfit", "unitPrice",
]);

function valueText(key, value) {
  if (value === null || value === undefined) return "";
  if (currencyKeys.has(key) && Number.isFinite(Number(value))) {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value));
  }
  return String(value);
}

function sectionsFor(item) {
  const payload = item.payload || {};
  const sections = [];
  const primary = payload.table || payload.entries;
  if (Array.isArray(primary) && primary.length) sections.push({ title: "Dados e memória", rows: primary });
  if (item.calculation_type !== "tabela-financeira" && payload.financialTable?.result?.rows?.length) {
    sections.push({ title: `Tabela financeira - ${payload.financialTable.state?.system || ""}`, rows: payload.financialTable.result.rows });
  }
  if (payload.pricingResult) {
    const expenses = (payload.pricingState?.expenses || []).map((row) => ({ name: row.name, amount: Number(row.amount) || 0 }));
    if (expenses.length) sections.push({ title: "Despesas", rows: expenses });
    sections.push({ title: "Resultado da precificação", rows: [payload.pricingResult] });
  }
  return sections;
}

function summaryFor(item) {
  if (Array.isArray(item.payload?.summary)) return item.payload.summary;
  const result = item.payload?.result;
  if (result) return [
    { label: "VPL", value: result.npv, format: "currency" },
    { label: "TIR", value: result.irr, format: "percent" },
    { label: "ROI", value: result.roi, format: "percent" },
    { label: "Índice de lucratividade", value: result.profitabilityIndex, format: "multiple" },
    { label: "Payback", value: result.paybackDuration || "Não recuperado", format: "text" },
  ];
  const financing = item.payload?.financialTable?.result;
  if (financing) return [
    { label: "Primeira parcela", value: financing.firstPayment, format: "currency" },
    { label: "Última parcela", value: financing.lastPayment, format: "currency" },
    { label: "Total de juros", value: financing.totalInterest, format: "currency" },
    { label: "Total pago", value: financing.totalPaid, format: "currency" },
  ];
  const pricing = item.payload?.pricingResult;
  if (pricing) return [
    { label: "Preço unitário", value: pricing.unitPrice, format: "currency" },
    { label: "Custo unitário", value: pricing.unitCost, format: "currency" },
    { label: "Lucro unitário", value: pricing.unitProfit, format: "currency" },
    { label: "Faturamento esperado", value: pricing.expectedRevenue, format: "currency" },
  ];
  return [];
}

function summaryText(item) {
  if (item.format === "currency") return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(item.value) || 0);
  if (item.format === "percent") return Number.isFinite(Number(item.value)) ? `${Number(item.value).toFixed(2)}%` : "N/D";
  if (item.format === "multiple") return Number.isFinite(Number(item.value)) ? `${Number(item.value).toFixed(3)}×` : "N/D";
  return String(item.value ?? "N/D");
}

function drawSummary(doc, items) {
  const visible = items.filter((item) => item.value !== null && item.value !== undefined && item.value !== "");
  if (!visible.length) return;
  doc.font("Helvetica-Bold").fontSize(13).fillColor("#171717").text("Indicadores");
  const startY = doc.y + 8;
  visible.slice(0, 8).forEach((item, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = 45 + column * 255;
    const y = startY + row * 48;
    doc.roundedRect(x, y, 240, 39, 5).fill("#f5f3ff");
    doc.fillColor("#64748b").font("Helvetica").fontSize(7.5).text(item.label, x + 10, y + 7, { width: 220 });
    doc.fillColor("#312e81").font("Helvetica-Bold").fontSize(11).text(summaryText(item), x + 10, y + 19, { width: 220, ellipsis: true });
  });
  doc.y = startY + Math.ceil(Math.min(visible.length, 8) / 2) * 48 + 5;
}

function drawExpenseDistribution(doc, entries = []) {
  const totals = new Map();
  entries.filter((entry) => entry.type === "saida" && Number(entry.amount) > 0).forEach((entry) => {
    const category = entry.category || "Outros";
    totals.set(category, (totals.get(category) || 0) + Number(entry.amount));
  });
  const data = [...totals].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const total = data.reduce((sum, [, value]) => sum + value, 0);
  if (!total) return;
  if (doc.y > 650) doc.addPage();
  doc.font("Helvetica-Bold").fontSize(13).fillColor("#171717").text("Distribuição das despesas");
  const colors = ["#4f46e5", "#7c3aed", "#0ea5e9", "#14b8a6", "#22c55e", "#eab308", "#f97316", "#ef4444"];
  let x = 45;
  const y = doc.y + 10;
  data.forEach(([, value], index) => {
    const width = 505 * (value / total);
    doc.rect(x, y, width, 18).fill(colors[index]);
    x += width;
  });
  doc.y = y + 28;
  data.forEach(([category, value], index) => {
    doc.rect(45, doc.y + 2, 8, 8).fill(colors[index]);
    doc.fillColor("#334155").font("Helvetica").fontSize(8).text(
      `${category}: ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value)} (${(value / total * 100).toFixed(1)}%)`,
      59, doc.y, { width: 480 },
    );
    doc.moveDown(0.35);
  });
  doc.moveDown(0.8);
}

function drawFlowChart(doc, rows) {
  const flows = rows.filter((row) => Number.isFinite(Number(row.flow))).slice(0, 36);
  if (!flows.length) return;
  if (doc.y > 570) doc.addPage();
  doc.font("Helvetica-Bold").fontSize(13).fillColor("#171717").text("Fluxo de caixa");
  const x = 55, y = doc.y + 12, width = 485, height = 105;
  const max = Math.max(...flows.map((row) => Math.abs(Number(row.flow))), 1);
  const zeroY = y + height / 2;
  doc.strokeColor("#cbd5e1").moveTo(x, zeroY).lineTo(x + width, zeroY).stroke();
  const barWidth = Math.max(2, width / flows.length - 3);
  flows.forEach((row, index) => {
    const value = Number(row.flow);
    const barHeight = Math.abs(value) / max * (height / 2 - 8);
    const barX = x + index * (width / flows.length) + 1;
    doc.fillColor(value >= 0 ? "#16a34a" : "#dc2626");
    doc.rect(barX, value >= 0 ? zeroY - barHeight : zeroY, barWidth, barHeight).fill();
  });
  doc.y = y + height + 15;
}

function drawTable(doc, title, rows) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]).slice(0, 7);
  const left = 45, width = 505, cellWidth = width / keys.length;
  const header = () => {
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#171717").text(title, left, doc.y + 5);
    doc.moveDown(0.5);
    const y = doc.y;
    doc.rect(left, y, width, 23).fill("#ede9fe");
    keys.forEach((key, index) => doc.fillColor("#312e81").fontSize(7).text(LABELS[key] || key, left + index * cellWidth + 3, y + 7, { width: cellWidth - 6, ellipsis: true }));
    doc.y = y + 23;
  };
  if (doc.y > 690) doc.addPage();
  header();
  rows.forEach((row, rowIndex) => {
    if (doc.y > 745) { doc.addPage(); header(); }
    const y = doc.y;
    if (rowIndex % 2) doc.rect(left, y, width, 21).fill("#f8fafc");
    keys.forEach((key, index) => doc.fillColor("#334155").font("Helvetica").fontSize(6.8).text(valueText(key, row[key]), left + index * cellWidth + 3, y + 6, { width: cellWidth - 6, ellipsis: true }));
    doc.y = y + 21;
  });
  doc.moveDown(0.8);
}

export async function historyPdf(item) {
  // O relatório é montado apenas depois que a rota confirma o usuário dono do registro.
  const doc = new PDFDocument({ size: "A4", margin: 45, bufferPages: true, info: { Title: item.title, Author: "FinSight" } });
  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const finished = new Promise((resolve, reject) => { doc.on("end", resolve); doc.on("error", reject); });
  doc.rect(0, 0, 595, 92).fill("#312e81");
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(22).text("FinSight", 45, 30);
  doc.fontSize(10).font("Helvetica").text("Relatório financeiro", 45, 59);
  doc.y = 115;
  doc.fillColor("#171717").font("Helvetica-Bold").fontSize(18).text(item.title);
  doc.font("Helvetica").fontSize(9).fillColor("#64748b").text(`Tipo: ${item.calculation_type}  |  Criado em: ${new Date(item.created_at).toLocaleString("pt-BR")}`);
  doc.moveDown(1);
  drawSummary(doc, summaryFor(item));
  const sections = sectionsFor(item);
  const flowRows = sections.flatMap((section) => section.rows).filter((row) => "flow" in row);
  drawFlowChart(doc, flowRows);
  drawExpenseDistribution(doc, item.payload?.entries || item.payload?.table || []);
  sections.forEach((section) => drawTable(doc, section.title, section.rows));
  const pages = doc.bufferedPageRange();
  for (let index = pages.start; index < pages.start + pages.count; index += 1) {
    doc.switchToPage(index);
    doc.fontSize(8).fillColor("#94a3b8").text(`FinSight • Página ${index + 1}`, 45, 785, { width: 505, align: "center" });
  }
  doc.end();
  await finished;
  return Buffer.concat(chunks);
}

export function historyPdfFilename(item) {
  return `historico-${item.id}.pdf`;
}
