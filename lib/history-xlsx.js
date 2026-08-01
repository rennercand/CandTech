import { zipSync, strToU8 } from "fflate";

const LABELS = {
  period: "Período", date: "Data", flow: "Fluxo", discounted: "Valor presente",
  accumulated: "Acumulado", openingBalance: "Saldo inicial", payment: "Prestação",
  interest: "Juros", amortization: "Amortização", balance: "Saldo final",
  category: "Categoria", description: "Descrição", type: "Tipo", amount: "Valor",
  name: "Despesa", totalCost: "Despesas totais", unitCost: "Custo unitário",
  unitProfit: "Lucro unitário", unitPrice: "Preço unitário", expectedRevenue: "Faturamento esperado",
};

const CURRENCY_KEYS = new Set([
  "flow", "discounted", "accumulated", "openingBalance", "payment", "interest",
  "amortization", "balance", "amount", "totalCost", "unitCost", "unitProfit",
  "unitPrice", "expectedRevenue",
]);

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
  return `<c r="${reference}" s="${style}"><f>${xml(formula)}</f><v>${Number(value) || 0}</v></c>`;
}

function sectionTotal(rows, keys, startRow, endRow) {
  const column = (key) => columnName(keys.indexOf(key));
  if (keys.includes("flow")) {
    const range = `${column("flow")}${startRow}:${column("flow")}${endRow}`;
    const value = rows.reduce((sum, row) => sum + Math.abs(Math.min(0, Number(row.flow) || 0)), 0);
    return { column: column("flow"), formula: `-SUMIF(${range},"<0",${range})`, value };
  }
  if (keys.includes("payment")) {
    const range = `${column("payment")}${startRow}:${column("payment")}${endRow}`;
    const value = rows.reduce((sum, row) => sum + (Number(row.payment) || 0), 0);
    return { column: column("payment"), formula: `SUM(${range})`, value };
  }
  if (keys.includes("amount")) {
    const amountRange = `${column("amount")}${startRow}:${column("amount")}${endRow}`;
    const value = rows.reduce(
      (sum, row) => sum + (keys.includes("type") && row.type !== "saida" ? 0 : Number(row.amount) || 0),
      0,
    );
    const formula = keys.includes("type")
      ? `SUMIF(${column("type")}${startRow}:${column("type")}${endRow},"saida",${amountRange})`
      : `SUM(${amountRange})`;
    return { column: column("amount"), formula, value };
  }
  return null;
}

function reportSections(item) {
  const payload = item.payload || {};
  const sections = [];
  const primary = payload.table || payload.entries;
  if (Array.isArray(primary) && primary.length) sections.push({ title: "Dados e memória do cálculo", rows: primary });
  if (item.calculation_type !== "tabela-financeira" && payload.financialTable?.result?.rows?.length) {
    sections.push({ title: `Tabela financeira - ${payload.financialTable.state?.system || ""}`, rows: payload.financialTable.result.rows });
  }
  const expenses = (payload.pricingState?.expenses || []).map((expense) => ({ name: expense.name, amount: Number(expense.amount) || 0 }));
  if (expenses.length) sections.push({ title: "Despesas do produto", rows: expenses });
  if (payload.pricingResult) sections.push({ title: "Resultado da precificação", rows: [payload.pricingResult] });
  return sections;
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
        if (typeof data[key] === "number" || CURRENCY_KEYS.has(key)) {
          return cell(ref, Number(data[key]) || 0, CURRENCY_KEYS.has(key) ? 3 : 0, "number");
        }
        return cell(ref, data[key]);
      }));
    }
    const dataEndRow = rowNumber - 1;
    const total = sectionTotal(section.rows, keys, dataStartRow, dataEndRow);
    if (total) {
      const totalRow = rowNumber;
      addRow([
        cell(`A${totalRow}`, "Total gasto", 6),
        formulaCell(`${total.column}${totalRow}`, total.formula, total.value),
      ], 22);
    }
    rows.push(`<row r="${rowNumber}"/>`);
    rowNumber += 1;
    // Cada tabela recebe filtro próprio quando não se sobrepõe à próxima seção.
    if (!firstFilter) firstFilter = `A${headerRow}:${columnName(keys.length - 1)}${dataEndRow}`;
  }

  const widths = Array.from({ length: maxColumns }, (_, index) => {
    const width = index === 0 ? 18 : index === 1 ? 24 : 17;
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
    "xl/styles.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="R$ #,##0.00;[Red]-R$ #,##0.00"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts><fonts count="4"><font><sz val="10"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="14"/><name val="Aptos Display"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Aptos"/></font><font><b/><color rgb="FF312E81"/><sz val="10"/><name val="Aptos"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF312E81"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF4F46E5"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="3"><border/><border><bottom style="thin"><color rgb="FFD7DCE5"/></bottom></border><border><top style="medium"><color rgb="FF4F46E5"/></top></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right"/></xf><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1"><alignment horizontal="left"/></xf><xf numFmtId="164" fontId="3" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1" applyNumberFormat="1"><alignment horizontal="right"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`),
    "xl/worksheets/sheet1.xml": strToU8(worksheetXml(item)),
  };
  return Buffer.from(zipSync(files, { level: 6 }));
}

export function historyXlsxFilename(item) {
  return `historico-${item.id}.xlsx`;
}
