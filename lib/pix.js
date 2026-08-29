const PIX_GUI = "BR.GOV.BCB.PIX";
const text = (value, max) => String(value || "").trim().slice(0, max);

function cleanPixKey(value) {
  let key = String(value || "").trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1).trim();
  }
  key = key.normalize("NFKC").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").trim();
  const compact = key.replace(/\s+/g, "");
  if (compact.includes("@")) return compact.toLowerCase();

  const unwrapped = compact.replace(/^\{([0-9a-f-]+)\}$/i, "$1");
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(unwrapped)) {
    return unwrapped.toLowerCase();
  }

  const digits = key.replace(/\D/g, "");
  if (/^\+/.test(key) || /[()\s]/.test(key)) {
    if (/^55\d{10,11}$/.test(digits)) return `+${digits}`;
    if (/^\d{10,11}$/.test(digits)) return `+55${digits}`;
  }
  if (/^[\d./\-\s]+$/.test(key) && (digits.length === 11 || digits.length === 14)) return digits;
  return compact;
}

function cleanMerchantText(value, max) {
  return text(value, max)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 $%*+\-./:]/g, "")
    .toUpperCase()
    .slice(0, max);
}

function emvField(id, value) {
  const content = String(value);
  const length = new TextEncoder().encode(content).length;
  if (!/^\d{2}$/.test(id) || length > 99) throw new Error("PIX_EMV_FIELD_INVALID");
  return `${id}${String(length).padStart(2, "0")}${content}`;
}

function crc16(payload) {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(payload)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function parseEmvFields(payload) {
  const fields = [];
  let offset = 0;
  while (offset < payload.length) {
    const id = payload.slice(offset, offset + 2);
    const lengthText = payload.slice(offset + 2, offset + 4);
    if (!/^\d{2}$/.test(id) || !/^\d{2}$/.test(lengthText)) throw new Error("PIX_EMV_INVALID");
    const length = Number(lengthText);
    const value = payload.slice(offset + 4, offset + 4 + length);
    if (new TextEncoder().encode(value).length !== length) throw new Error("PIX_EMV_INVALID");
    fields.push({ id, length, value });
    offset += 4 + value.length;
  }
  if (offset !== payload.length) throw new Error("PIX_EMV_INVALID");
  return fields;
}

/** Decodifica os campos usados no BR Code para validar o payload sem depender do QR. */
export function decodePixPayload(payload) {
  const fields = parseEmvFields(String(payload || ""));
  const merchantTemplate = fields.find((field) => field.id === "26");
  const merchantFields = merchantTemplate ? parseEmvFields(merchantTemplate.value) : [];
  const crcField = fields.at(-1);
  const bodyWithCrcHeader = String(payload || "").slice(0, -4);
  return {
    fields: Object.fromEntries(fields.map((field) => [field.id, field.value])),
    merchantAccount: {
      gui: merchantFields.find((field) => field.id === "00")?.value || "",
      dictKey: merchantFields.find((field) => field.id === "01")?.value || "",
      description: merchantFields.find((field) => field.id === "02")?.value || "",
    },
    validCrc: crcField?.id === "63" && crcField.length === 4 && crcField.value === crc16(bodyWithCrcHeader),
  };
}

export function pixAmounts() {
  const monthly = Number(process.env.PIX_MONTHLY_AMOUNT_CENTS || 6000);
  const setup = Number(process.env.PIX_SETUP_AMOUNT_CENTS || 12000);
  return {
    monthly: Number.isInteger(monthly) && monthly > 0 ? monthly : 6000,
    setup: Number.isInteger(setup) && setup >= 0 ? setup : 12000,
  };
}

export function pixRequestTtlHours() {
  const value = Number(process.env.PIX_PAYMENT_TTL_HOURS || 72);
  return Number.isInteger(value) && value >= 1 && value <= 720 ? value : 72;
}

export function pixSettings() {
  const key = cleanPixKey(process.env.PIX_KEY);
  const receiverName = cleanMerchantText(process.env.PIX_RECEIVER_NAME || "CANDTECH", 25);
  const receiverCity = cleanMerchantText(process.env.PIX_RECEIVER_CITY || "MAIRINQUE", 15);
  const configurationIssue = !key
    ? "PIX_KEY_MISSING"
    : key.length > 77
      ? "PIX_KEY_TOO_LONG"
      : !/^[\x21-\x7E]+$/.test(key)
        ? "PIX_KEY_INVALID_CHARACTERS"
        : !receiverName
          ? "PIX_RECEIVER_NAME_MISSING"
          : !receiverCity
            ? "PIX_RECEIVER_CITY_MISSING"
            : null;
  return { key, receiverName, receiverCity, configured: !configurationIssue, configurationIssue };
}

/** Gera o Pix Copia e Cola segundo o padrão EMV/BR Code, incluindo CRC16. */
export function buildPixPayload({ key, receiverName, receiverCity, amountCents, txid, description = "CANDTECH" }) {
  const safeKey = cleanPixKey(key);
  const safeName = cleanMerchantText(receiverName, 25);
  const safeCity = cleanMerchantText(receiverCity, 15);
  const safeTxid = cleanMerchantText(txid || "***", 25) || "***";
  if (!safeKey || !safeName || !safeCity) throw new Error("PIX_NOT_CONFIGURED");
  if (safeKey.length > 77 || !/^[\x21-\x7E]+$/.test(safeKey)) throw new Error("PIX_KEY_INVALID");
  if (!Number.isInteger(Number(amountCents)) || Number(amountCents) <= 0) throw new Error("PIX_AMOUNT_INVALID");
  const amount = (Number(amountCents) / 100).toFixed(2);
  const guiField = emvField("00", PIX_GUI);
  const dictField = emvField("01", safeKey);
  const availableDescriptionLength = Math.max(0, 99 - guiField.length - dictField.length - 4);
  const safeDescription = cleanMerchantText(description, Math.min(40, availableDescriptionLength));
  const merchantAccount = guiField + dictField + (safeDescription ? emvField("02", safeDescription) : "");
  const additional = emvField("05", safeTxid);
  const body = emvField("00", "01") + emvField("26", merchantAccount) + emvField("52", "0000")
    + emvField("53", "986") + emvField("54", amount) + emvField("58", "BR")
    + emvField("59", safeName) + emvField("60", safeCity) + emvField("62", additional) + "6304";
  const payload = `${body}${crc16(body)}`;
  const decoded = decodePixPayload(payload);
  if (decoded.merchantAccount.gui !== PIX_GUI || decoded.merchantAccount.dictKey !== safeKey || !decoded.validCrc) {
    throw new Error("PIX_EMV_INVALID");
  }
  return payload;
}

export function formatCents(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0) / 100);
}
