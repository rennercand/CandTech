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
  const sections = sectionsFor(item);
  const flowRows = sections.flatMap((section) => section.rows).filter((row) => "flow" in row);
  drawFlowChart(doc, flowRows);
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
