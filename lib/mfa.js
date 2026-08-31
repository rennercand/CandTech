import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_PERIOD_SECONDS = 30;

function encryptionKey() {
  const value = String(process.env.MFA_ENCRYPTION_KEY || "");
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32) throw new Error("MFA_ENCRYPTION_KEY precisa conter 32 bytes em Base64");
  return decoded;
}

function base32Encode(value) {
  let bits = "";
  for (const byte of value) bits += byte.toString(2).padStart(8, "0");
  let result = "";
  for (let index = 0; index < bits.length; index += 5) {
    result += BASE32[Number.parseInt(bits.slice(index, index + 5).padEnd(5, "0"), 2)];
  }
  return result;
}

function base32Decode(value) {
  const clean = String(value || "").toUpperCase().replace(/=+$/g, "").replace(/\s/g, "");
  if (!clean || [...clean].some((character) => !BASE32.includes(character))) throw new Error("Segredo TOTP inválido");
  let bits = "";
  for (const character of clean) bits += BASE32.indexOf(character).toString(2).padStart(5, "0");
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

export function generateMfaSecret() {
  return base32Encode(randomBytes(20));
}

export function encryptMfaSecret(secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(secret), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptMfaSecret(value) {
  const parts = String(value || "").split(".");
  if (parts.length !== 3) throw new Error("Segredo MFA cifrado inválido");
  const [iv, tag, encrypted] = parts.map((part) => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

function totpAtCounter(secret, counter) {
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret)).update(counterBytes).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

export function totpCode(secret, timestamp = Date.now()) {
  return totpAtCounter(secret, Math.floor(timestamp / 1_000 / TOTP_PERIOD_SECONDS));
}

export function verifyTotp(secret, code, { timestamp = Date.now(), window = 1 } = {}) {
  const normalized = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) return false;
  const counter = Math.floor(timestamp / 1_000 / TOTP_PERIOD_SECONDS);
  const received = Buffer.from(normalized);
  for (let offset = -window; offset <= window; offset += 1) {
    const expected = Buffer.from(totpAtCounter(secret, counter + offset));
    if (expected.length === received.length && timingSafeEqual(expected, received)) return true;
  }
  return false;
}

export function mfaOtpAuthUri({ secret, email }) {
  const issuer = "CandTech";
  const label = `${issuer}:${String(email || "conta").trim().toLowerCase()}`;
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: "6", period: String(TOTP_PERIOD_SECONDS) });
  return `otpauth://totp/${encodeURIComponent(label)}?${params}`;
}

export async function mfaQrCodeDataUrl(uri) {
  const QRCode = (await import("qrcode")).default;
  return QRCode.toDataURL(uri, { errorCorrectionLevel: "M", margin: 2, width: 280 });
}

export function hashMfaValue(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

export function generateMfaChallenge() {
  return randomBytes(32).toString("base64url");
}

export function generateRecoveryCodes(count = 8) {
  return Array.from({ length: count }, () => {
    const raw = randomBytes(8).toString("hex").toUpperCase();
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
  });
}

export function normalizeRecoveryCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-F0-9]/g, "");
}
