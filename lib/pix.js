const text = (value, max) => String(value || "").trim().slice(0, max);

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
  return `${id}${String(content.length).padStart(2, "0")}${content}`;
}

function crc16(payload) {
  let crc = 0xffff;
  for (let index = 0; index < payload.length; index += 1) {
    crc ^= payload.charCodeAt(index) << 8;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
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
  const key = text(process.env.PIX_KEY, 77);
  const receiverName = cleanMerchantText(process.env.PIX_RECEIVER_NAME || "CANDTECH", 25);
  const receiverCity = cleanMerchantText(process.env.PIX_RECEIVER_CITY || "MAIRINQUE", 15);
  return { key, receiverName, receiverCity, configured: Boolean(key && receiverName && receiverCity) };
}

/** Gera o Pix Copia e Cola segundo o padrão EMV/BR Code, incluindo CRC16. */
export function buildPixPayload({ key, receiverName, receiverCity, amountCents, txid, description = "CANDTECH" }) {
  const safeKey = text(key, 77);
  const safeName = cleanMerchantText(receiverName, 25);
  const safeCity = cleanMerchantText(receiverCity, 15);
  const safeTxid = cleanMerchantText(txid || "***", 25) || "***";
  const safeDescription = cleanMerchantText(description, 40);
  if (!safeKey || !safeName || !safeCity) throw new Error("PIX_NOT_CONFIGURED");
  const amount = (Number(amountCents) / 100).toFixed(2);
  const merchantAccount = emvField("00", "BR.GOV.BCB.PIX") + emvField("01", safeKey) + (safeDescription ? emvField("02", safeDescription) : "");
  const additional = emvField("05", safeTxid);
  const body = emvField("00", "01") + emvField("26", merchantAccount) + emvField("52", "0000")
    + emvField("53", "986") + emvField("54", amount) + emvField("58", "BR")
    + emvField("59", safeName) + emvField("60", safeCity) + emvField("62", additional) + "6304";
  return `${body}${crc16(body)}`;
}

export function formatCents(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0) / 100);
}
