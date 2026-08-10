import { strFromU8, unzipSync } from "fflate";

const HEADER_ALIASES = {
  produto: "name", nome: "name", product: "name",
  variacao: "variant", variante: "variant", variation: "variant",
  sku: "sku", codigo: "sku",
  quantidade: "quantity", qtd: "quantity", quantity: "quantity",
  estoque_minimo: "minimumQuantity", minimo: "minimumQuantity",
  custo_unitario: "unitCost", custo: "unitCost",
  preco_de_venda: "salePrice", preco_venda: "salePrice", preco: "salePrice",
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
  const firstLine = source.split(/\r?\n/, 1)[0] || "";
  const delimiter = [";", "\t", ","].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows = []; let row = []; let value = ""; let quoted = false;
  for (let index = 0; index <= source.length; index += 1) {
    const char = source[index] ?? "\n";
    if (char === '"' && quoted && source[index + 1] === '"') { value += '"'; index += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (!quoted && char === delimiter) { row.push(value.trim()); value = ""; continue; }
    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(value.trim()); value = "";
      if (row.some(Boolean)) rows.push(row);
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
  const shared = [...sharedXml.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)].map((match) =>
    decodeXml([...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((part) => part[1]).join("")));
  const sheetName = Object.keys(files).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort()[0];
  if (!sheetName) throw new Error("A planilha não contém uma aba legível.");
  const xml = strFromU8(files[sheetName]);
  return [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((rowMatch) => {
    const row = [];
    for (const cell of rowMatch[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const reference = cell[1].match(/\br="([^"]+)"/)?.[1] || "A1";
      const type = cell[1].match(/\bt="([^"]+)"/)?.[1] || "n";
      const raw = cell[2].match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1]
        ?? cell[2].match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? "";
      row[columnIndex(reference)] = type === "s" ? shared[Number(raw)] ?? "" : decodeXml(raw);
    }
    return row.map((value) => String(value ?? "").trim());
  }).filter((row) => row.some(Boolean));
}

function rowsToProducts(rows) {
  if (/^sep=/i.test(String(rows[0]?.[0] || ""))) rows = rows.slice(1);
  if (rows.length < 2) throw new Error("Inclua um cabeçalho e pelo menos um produto.");
  const headers = rows[0].map((header) => HEADER_ALIASES[key(header)] || "");
  for (const required of ["name", "sku", "quantity"]) {
    if (!headers.includes(required)) throw new Error("A planilha precisa das colunas Produto, SKU e Quantidade.");
  }
  const products = []; const byProduct = new Map(); const skus = new Set(); const errors = [];
  rows.slice(1).forEach((values, index) => {
    const source = Object.fromEntries(headers.map((header, column) => [header, values[column] || ""]).filter(([header]) => header));
    const name = String(source.name || "").trim(); const sku = String(source.sku || "").trim().toUpperCase();
    const quantity = Number(String(source.quantity || "0").replace(",", "."));
    if (!name || !sku || !Number.isFinite(quantity) || quantity < 0) { errors.push(`Linha ${index + 2}: produto, SKU ou quantidade inválidos.`); return; }
    if (skus.has(sku)) { errors.push(`Linha ${index + 2}: SKU ${sku} repetido.`); return; }
    skus.add(sku);
    const productKey = `${name.toLowerCase()}|${source.category || ""}|${source.unit || "un"}`;
    let product = byProduct.get(productKey);
    if (!product) {
      product = { name, category: source.category || "", unit: source.unit || "un", variants: [] };
      byProduct.set(productKey, product); products.push(product);
    }
    const numeric = (value) => Math.max(0, Number(String(value || "0").replace(",", ".")) || 0);
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
  return { products, errors, rowCount: rows.length - 1, variantCount: skus.size };
}

export function parseInventoryText(text) {
  return rowsToProducts(parseDelimited(text));
}

export async function parseInventoryFile(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "xlsx") return rowsToProducts(parseXlsx(await file.arrayBuffer()));
  if (["csv", "tsv", "txt"].includes(extension)) return parseInventoryText(await file.text());
  throw new Error("Use um arquivo CSV, TSV, TXT ou XLSX.");
}

export function matchInventoryEntry(preview, existingVariants) {
  const currentBySku = new Map(
    (existingVariants || []).map((variant) => [String(variant.sku || "").trim().toUpperCase(), variant]),
  );
  const lines = [];
  const errors = [...(preview?.errors || [])];
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
