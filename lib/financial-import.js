import { strFromU8, unzipSync } from "fflate";

const HEADER_ALIASES = {
  data: "date", date: "date", dt_lancamento: "date", data_lancamento: "date",
  descricao: "description", descrição: "description", historico: "description", histórico: "description",
  memo: "description", nome: "description", name: "description",
  valor: "amount", amount: "amount", quantia: "amount",
  credito: "credit", crédito: "credit", entrada: "credit",
  debito: "debit", débito: "debit", saida: "debit", saída: "debit",
  tipo: "type", natureza: "type", type: "type",
  id: "sourceId", identificador: "sourceId", fitid: "sourceId", documento: "sourceId", numero: "sourceId",
};

function normalizedKey(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function decodeXml(value) {
  return String(value || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function parseDelimited(text) {
  const source = String(text || "").replace(/^\uFEFF/, "");
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
      row.push(value.trim()); value = ""; rows.push(row); row = []; continue;
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
    rows.push(row.map((item) => String(item ?? "").trim()));
  }
  return rows;
}

async function readTextFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function parseNumber(value) {
  let compact = String(value ?? "").trim().replace(/\s/g, "").replace(/[^0-9,().+-]/g, "");
  if (!compact) return null;
  const parenthesized = compact.startsWith("(") && compact.endsWith(")");
  compact = compact.replace(/[()]/g, "");
  const comma = compact.lastIndexOf(",");
  const dot = compact.lastIndexOf(".");
  let normalized = compact;
  if (comma > dot) normalized = compact.replace(/\./g, "").replace(",", ".");
  else if (dot > comma && comma >= 0) normalized = compact.replace(/,/g, "");
  else if (comma >= 0) normalized = compact.replace(",", ".");
  const number = Number(normalized);
  if (!Number.isFinite(number)) return null;
  return parenthesized ? -Math.abs(number) : number;
}

function normalizeDate(value) {
  const source = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(source)) return source;
  const isoCompact = source.match(/^(\d{4})(\d{2})(\d{2})/);
  if (isoCompact) return `${isoCompact[1]}-${isoCompact[2]}-${isoCompact[3]}`;
  const brazilian = source.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (brazilian) return `${brazilian[3]}-${brazilian[2].padStart(2, "0")}-${brazilian[1].padStart(2, "0")}`;
  const serial = Number(source);
  if (Number.isFinite(serial) && serial >= 20_000 && serial <= 80_000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
  }
  return "";
}

function findHeader(rows) {
  let best = null;
  rows.slice(0, 30).forEach((row, index) => {
    const mapped = row.map((header) => HEADER_ALIASES[normalizedKey(header)] || "");
    const fields = new Set(mapped.filter(Boolean));
    if (!fields.has("date") || !(fields.has("amount") || fields.has("credit") || fields.has("debit"))) return;
    if (!best || fields.size > best.fields.size) best = { index, mapped, fields, original: row };
  });
  return best;
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function addFingerprints(rows, sourceFormat) {
  const occurrences = new Map();
  return Promise.all(rows.map(async (row) => {
    const signature = `${row.date}|${row.type}|${Number(row.amount).toFixed(2)}|${normalizedKey(row.description)}`;
    const occurrence = (occurrences.get(signature) || 0) + 1;
    occurrences.set(signature, occurrence);
    const stableSource = row.sourceId ? `id:${normalizedKey(row.sourceId)}` : `row:${signature}|${occurrence}`;
    return { ...row, fingerprint: await sha256(`candtech-finance-v1|${sourceFormat}|${stableSource}`) };
  }));
}

/** Normaliza linhas tabulares e mantém erros fora do conjunto confirmável. */
export async function parseFinancialRows(inputRows, sourceFormat = "csv") {
  let rows = inputRows;
  if (/^sep=/i.test(String(rows[0]?.[0] || ""))) rows = rows.slice(1);
  const header = findHeader(rows);
  if (!header) throw new Error("O arquivo precisa identificar Data e Valor (ou Crédito/Débito).");
  const warnings = []; const errors = []; const accepted = [];
  if (header.index > 0) warnings.push(`Cabeçalho encontrado na linha ${header.index + 1}; as linhas anteriores foram ignoradas.`);
  const ignoredHeaders = header.original.filter((value, index) => value && !header.mapped[index]);
  if (ignoredHeaders.length) warnings.push(`Colunas não reconhecidas foram ignoradas: ${ignoredHeaders.join(", ")}.`);
  rows.slice(header.index + 1).forEach((values, index) => {
    if (!values.some((value) => String(value || "").trim())) return;
    const source = Object.fromEntries(header.mapped.map((field, column) => [field, values[column] || ""]).filter(([field]) => field));
    const date = normalizeDate(source.date);
    const credit = parseNumber(source.credit);
    const debit = parseNumber(source.debit);
    let signedAmount = parseNumber(source.amount);
    if (signedAmount === null) signedAmount = credit !== null && credit !== 0 ? Math.abs(credit) : debit !== null ? -Math.abs(debit) : null;
    const typeText = normalizedKey(source.type);
    if (["debito", "saida", "expense", "d"].includes(typeText)) signedAmount = -Math.abs(signedAmount || 0);
    if (["credito", "entrada", "income", "c"].includes(typeText)) signedAmount = Math.abs(signedAmount || 0);
    const description = String(source.description || "Movimentação importada").normalize("NFKC").trim().slice(0, 160);
    const lineNumber = header.index + index + 2;
    if (!date || signedAmount === null || signedAmount === 0) {
      errors.push(`Linha ${lineNumber}: data ou valor inválido.`); return;
    }
    accepted.push({ date, category: "A classificar", description, type: signedAmount < 0 ? "saida" : "entrada", amount: Math.abs(signedAmount), sourceId: String(source.sourceId || "").trim().slice(0, 120) });
  });
  if (!accepted.length) throw new Error(errors[0] || "Nenhum lançamento válido foi encontrado.");
  return { format: sourceFormat, rows: await addFingerprints(accepted, sourceFormat), errors, warnings, rowCount: accepted.length + errors.length };
}

export async function parseFinancialText(text) {
  return parseFinancialRows(parseDelimited(text), "csv");
}

function ofxTag(block, name) {
  return decodeXml(block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, "i"))?.[1] || "").trim();
}

/** Aceita OFX SGML e XML, inclusive arquivos QFX com os mesmos campos bancários. */
export async function parseFinancialOfx(text) {
  const source = String(text || "");
  const blocks = [...source.matchAll(/<STMTTRN>([\s\S]*?)(?=<STMTTRN>|<\/BANKTRANLIST>|$)/gi)].map((match) => match[1]);
  if (!blocks.length) throw new Error("Nenhuma movimentação bancária foi encontrada no OFX.");
  const errors = []; const rows = [];
  blocks.forEach((block, index) => {
    const date = normalizeDate(ofxTag(block, "DTPOSTED"));
    const signedAmount = parseNumber(ofxTag(block, "TRNAMT"));
    const name = ofxTag(block, "NAME"); const memo = ofxTag(block, "MEMO");
    const description = [name, memo && normalizedKey(memo) !== normalizedKey(name) ? memo : ""].filter(Boolean).join(" — ").slice(0, 160) || "Movimentação OFX";
    if (!date || signedAmount === null || signedAmount === 0) { errors.push(`Movimentação ${index + 1}: data ou valor inválido.`); return; }
    rows.push({ date, category: "A classificar", description, type: signedAmount < 0 ? "saida" : "entrada", amount: Math.abs(signedAmount), sourceId: ofxTag(block, "FITID").slice(0, 120) });
  });
  if (!rows.length) throw new Error(errors[0] || "Nenhum lançamento válido foi encontrado no OFX.");
  return { format: "ofx", rows: await addFingerprints(rows, "ofx"), errors, warnings: [], rowCount: blocks.length };
}

/** Lê o extrato somente no navegador; nenhum byte do arquivo é enviado ao servidor. */
export async function parseFinancialFile(file) {
  if (!file || file.size > 10 * 1024 * 1024) throw new Error("O arquivo deve ter no máximo 10 MB.");
  const extension = String(file.name || "").split(".").pop()?.toLowerCase();
  if (["ofx", "qfx"].includes(extension)) return parseFinancialOfx(await readTextFile(file));
  if (extension === "xlsx") return parseFinancialRows(parseXlsx(await file.arrayBuffer()), "xlsx");
  if (["csv", "tsv", "txt"].includes(extension)) return parseFinancialText(await readTextFile(file));
  throw new Error("Use um arquivo CSV, OFX, QFX ou XLSX.");
}

/** Marca repetição no próprio arquivo e em lançamentos já salvos. */
export function markFinancialDuplicates(rows, existingEntries = []) {
  const existing = new Set(existingEntries.map((entry) => entry?.fingerprint).filter(Boolean));
  const seen = new Set();
  const marked = (rows || []).map((row) => {
    const duplicate = existing.has(row.fingerprint) || seen.has(row.fingerprint);
    seen.add(row.fingerprint);
    return { ...row, duplicate };
  });
  return {
    rows: marked,
    accepted: marked.filter((row) => !row.duplicate),
    duplicateCount: marked.filter((row) => row.duplicate).length,
  };
}
