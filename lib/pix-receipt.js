import { createHash, randomUUID } from "node:crypto";

export const PIX_RECEIPT_MAX_BYTES = 5 * 1024 * 1024;

const MIME_BY_EXTENSION = new Map([
  ["pdf", "application/pdf"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
]);

const EXTENSION_BY_MIME = new Map([
  ["application/pdf", "pdf"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

export class PixReceiptValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "PixReceiptValidationError";
    this.status = status;
  }
}

function hasPrefix(bytes, prefix) {
  return prefix.every((value, index) => bytes[index] === value);
}

function hasValidSignature(bytes, contentType) {
  if (contentType === "application/pdf") return hasPrefix(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
  if (contentType === "image/jpeg") return hasPrefix(bytes, [0xff, 0xd8, 0xff]);
  if (contentType === "image/png") return hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (contentType === "image/webp") {
    return hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46])
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  }
  return false;
}

export function normalizeReceiptFilename(value) {
  const filename = String(value || "").normalize("NFC").trim();
  if (!filename || filename.length > 180) throw new PixReceiptValidationError("Nome de arquivo inválido.");
  if (filename.includes("/") || filename.includes("\\") || filename.includes("\0") || filename.includes("..")) {
    throw new PixReceiptValidationError("O nome do arquivo contém um caminho não permitido.");
  }
  if (!/^[^\u0000-\u001f\u007f]+$/u.test(filename)) throw new PixReceiptValidationError("Nome de arquivo inválido.");
  return filename;
}

export function validatePixReceipt({ bytes: input, filename: inputFilename, contentType: inputContentType }) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || 0);
  if (!bytes.byteLength) throw new PixReceiptValidationError("O comprovante está vazio.");
  if (bytes.byteLength > PIX_RECEIPT_MAX_BYTES) throw new PixReceiptValidationError("O comprovante deve ter no máximo 5 MB.", 413);

  const originalFilename = normalizeReceiptFilename(inputFilename);
  const extension = originalFilename.split(".").at(-1)?.toLowerCase() || "";
  const contentType = String(inputContentType || "").split(";", 1)[0].trim().toLowerCase();
  const expectedMime = MIME_BY_EXTENSION.get(extension);
  if (!expectedMime || !EXTENSION_BY_MIME.has(contentType) || expectedMime !== contentType) {
    throw new PixReceiptValidationError("Envie um arquivo PDF, JPG, PNG ou WEBP válido.", 415);
  }
  if (!hasValidSignature(bytes, contentType)) {
    throw new PixReceiptValidationError("O conteúdo do arquivo não corresponde ao formato informado.", 415);
  }

  return {
    bytes,
    originalFilename,
    contentType,
    extension: EXTENSION_BY_MIME.get(contentType),
    sizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function createReceiptStoragePath(extension) {
  if (![...EXTENSION_BY_MIME.values()].includes(extension)) throw new PixReceiptValidationError("Extensão de comprovante inválida.");
  return `pix-receipts/${randomUUID()}.${extension}`;
}
