import { strFromU8, unzipSync } from "fflate";

const HEADER_ALIASES = {
  produto: "name", nome: "name", product: "name",
  variacao: "variant", variante: "variant", variation: "variant",
  sku: "sku", codigo: "sku",
  quantidade: "quantity", qtd: "quantity", quantity: "quantity",
  estoque_minimo: "minimumQuantity", minimo: "minimumQuantity",
  custo_unitario: "unitCost", custo: "unitCost",
  preco_de_venda: "salePrice", preco_venda: "salePrice", preco: "salePrice", valor: "salePrice",
  categoria: "category", category: "category",
  unidade: "unit", unit: "unit",
  localizacao: "location", local: "location",
  lote: "lotCode", validade: "expiresOn",
};

function key(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function decodeXml(value) {
  return String(value || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function parseDelimited(text) {
  const source = String(text || "").replace(/^\uFEFF/, "");
  // Títulos e linhas vazias podem vir antes do cabeçalho. Avaliar uma amostra
  // evita confundir a vírgula decimal de preços com o separador da planilha.
  const sample = source.split(/\r?\n/).slice(0, 20);
  const delimiter = [";", "\t", ","].sort((a, b) => {
    const score = (separator) => sample.reduce((total, line) => total + Math.max(0, line.split(separator).length - 1), 0);
    return score(b) - score(a);
  })[0];
  const rows = []; let row = []; let value = ""; let quoted = false;
  for (let index = 0; index <= source.length; index += 1) {
    const char = source[index] ?? "\n";
    if (char === '"' && quoted && source[index + 1] === '"') { value += '"'; index += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (!quoted && char === delimiter) { row.push(value.trim()); value = ""; continue; }
    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(value.trim()); value = "";
      rows.push(row);
      row = []; continue;
    }
    value += char;
  }
  return rows;
}

function columnIndex(reference) {
  const letters = String(reference || "A").match(/[A-Z]+/i)?.[0]?.toUpperCase() || "A";
  return [...letters].reduce((result, letter) => result * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function parseXlsx(buffer) {
  const files = unzipSync(new Uint8Array(buffer));
  const sharedXml = files["xl/sharedStrings.xml"] ? strFromU8(files["xl/sharedStrings.xml"]) : "";
  const shared = [...sharedXml.matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((match) =>
    decodeXml([...match[1].matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((part) => part[1]).join("")));
  const sheetName = Object.keys(files).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort()[0];
  if (!sheetName) throw new Error("A planilha não contém uma aba legível.");
  const xml = strFromU8(files[sheetName]);
  const rows = [];
  for (const rowMatch of xml.matchAll(/<(?:\w+:)?row\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?row>/g)) {
    const rowNumber = Number(rowMatch[1].match(/\br="(\d+)"/)?.[1]) || rows.length + 1;
    while (rows.length < rowNumber - 1) rows.push([]);
    const row = [];
    for (const cell of rowMatch[2].matchAll(/<(?:\w+:)?c\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?c>/g)) {
      const reference = cell[1].match(/\br="([^"]+)"/)?.[1] || "A1";
      const type = cell[1].match(/\bt="([^"]+)"/)?.[1] || "n";
      const raw = cell[2].match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1]
        ?? cell[2].match(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/)?.[1] ?? "";
      row[columnIndex(reference)] = type === "s" ? shared[Number(raw)] ?? "" : decodeXml(raw);
    }
    rows.push(row.map((value) => String(value ?? "").trim()));
  }
  return rows;
}

async function readTextFile(file) {
  if (typeof file.arrayBuffer !== "function") return file.text();
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // Muitos ERPs e versões antigas do Excel exportam CSV em Windows-1252.
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function parseNumber(value) {
  const compact = String(value ?? "").trim().replace(/\s/g, "").replace(/[^0-9,.-]/g, "");
  if (!compact) return 0;
  const comma = compact.lastIndexOf(",");
  const dot = compact.lastIndexOf(".");
  let normalized = compact;
  if (comma > dot) normalized = compact.replace(/\./g, "").replace(",", ".");
  else if (dot > comma && comma >= 0) normalized = compact.replace(/,/g, "");
  else if (comma >= 0) normalized = compact.replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function findHeader(rows) {
  let best = null;
  rows.slice(0, 30).forEach((row, index) => {
    const mapped = row.map((header) => HEADER_ALIASES[key(header)] || "");
    const fields = new Set(mapped.filter(Boolean));
    if (!fields.has("name") || !fields.has("sku")) return;
    if (!best || fields.size > best.fields.size) best = { index, mapped, fields, original: row };
  });
  return best;
}

export function parseInventoryRows(inputRows) {
  let rows = inputRows;
  if (/^sep=/i.test(String(rows[0]?.[0] || ""))) rows = rows.slice(1);
  if (rows.length < 2) throw new Error("Inclua um cabeçalho e pelo menos um produto.");
  const header = findHeader(rows);
  if (!header) throw new Error("A planilha precisa identificar as colunas Produto (ou Nome) e SKU.");
  const headers = header.mapped;
  const dataRows = rows.slice(header.index + 1);
  const ignoredHeaders = header.original.filter((value, index) => value && !headers[index]);
  const warnings = [];
  if (header.index > 0) warnings.push(`Cabeçalho encontrado na linha ${header.index + 1}; as linhas anteriores foram ignoradas.`);
  if (!header.fields.has("quantity")) warnings.push("Quantidade não informada: os produtos serão cadastrados com estoque inicial zero.");
  if (ignoredHeaders.length) warnings.push(`Colunas sem campo correspondente foram ignoradas: ${ignoredHeaders.join(", ")}.`);
  const products = []; const byProduct = new Map(); const skus = new Set(); const errors = [];
  dataRows.forEach((values, index) => {
    if (!values.some((value) => String(value || "").trim())) return;
    const source = Object.fromEntries(headers.map((header, column) => [header, values[column] || ""]).filter(([header]) => header));
    const name = String(source.name || "").trim(); const sku = String(source.sku || "").trim().toUpperCase();
    const quantity = parseNumber(source.quantity);
    const lineNumber = header.index + index + 2;
    if (!name || !sku || quantity < 0) { errors.push(`Linha ${lineNumber}: produto, SKU ou quantidade inválidos.`); return; }
    if (skus.has(sku)) { errors.push(`Linha ${lineNumber}: SKU ${sku} repetido.`); return; }
    skus.add(sku);
    const productKey = `${name.toLowerCase()}|${source.category || ""}|${source.unit || "un"}`;
    let product = byProduct.get(productKey);
    if (!product) {
      product = { name, category: source.category || "", unit: source.unit || "un", variants: [] };
      byProduct.set(productKey, product); products.push(product);
    }
    const numeric = (value) => Math.max(0, parseNumber(value));
    const normalizedDate = (value) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return value;
      const serial = Number(value);
      if (!Number.isFinite(serial) || serial < 20_000 || serial > 80_000) return "";
      return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
    };
    product.variants.push({
      name: source.variant || "Padrão", sku, quantity, minimumQuantity: numeric(source.minimumQuantity),
      unitCost: numeric(source.unitCost), salePrice: numeric(source.salePrice), location: source.location || "",
      lotCode: source.lotCode || "", expiresOn: normalizedDate(source.expiresOn),
    });
  });
  if (!products.length && !errors.length) throw new Error("Nenhum produto foi encontrado abaixo do cabeçalho.");
  return {
    products, errors, warnings, rowCount: dataRows.length, variantCount: skus.size,
    hasQuantityColumn: header.fields.has("quantity"),
  };
}

export function parseInventoryText(text) {
  return parseInventoryRows(parseDelimited(text));
}

export async function parseInventoryFile(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "xlsx") return parseInventoryRows(parseXlsx(await file.arrayBuffer()));
  if (["csv", "tsv", "txt"].includes(extension)) return parseInventoryText(await readTextFile(file));
  throw new Error("Use um arquivo CSV, TSV, TXT ou XLSX.");
}

export function matchInventoryEntry(preview, existingVariants) {
  const currentBySku = new Map(
    (existingVariants || []).map((variant) => [String(variant.sku || "").trim().toUpperCase(), variant]),
  );
  const lines = [];
  const errors = [...(preview?.errors || [])];
  if (preview && !preview.hasQuantityColumn) {
    return { lines, errors: [...errors, "Para dar entrada no estoque, a planilha precisa da coluna Quantidade."] };
  }
  for (const product of preview?.products || []) {
    for (const imported of product.variants || []) {
      const sku = String(imported.sku || "").trim().toUpperCase();
      const current = currentBySku.get(sku);
      if (!current) {
        errors.push(`SKU ${sku || "não informado"} ainda não está cadastrado.`);
        continue;
      }
      if (!(Number(imported.quantity) > 0)) {
        errors.push(`SKU ${sku}: a quantidade recebida precisa ser maior que zero.`);
        continue;
      }
      lines.push({
        variantId: current.id,
        quantity: Number(imported.quantity),
        unitCost: Number(imported.unitCost) || Number(current.unitCost) || 0,
        lotCode: imported.lotCode || "",
        expiresOn: imported.expiresOn || "",
      });
    }
  }
  return { lines, errors };
}

export const INVENTORY_TEMPLATE = "Produto;Variação;SKU;Quantidade;Estoque mínimo;Custo unitário;Preço de venda;Categoria;Unidade;Localização;Lote;Validade\nPelúcia;Cachorro;PEL-CACH-001;10;2;15,00;35,00;Presentes;un;Prateleira A;LOTE-01;2027-12-31";
