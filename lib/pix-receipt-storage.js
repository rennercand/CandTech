import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createReceiptStoragePath } from "./pix-receipt.js";

function useVercelBlob() {
  return process.env.VERCEL === "1" || Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

function localReceiptPath(storageKey) {
  const name = String(storageKey || "").replace(/^local:/, "");
  if (!/^[0-9a-f-]{36}\.(pdf|jpg|png|webp)$/i.test(name)) throw new Error("Referência local de comprovante inválida.");
  return path.join(process.cwd(), "data", "pix-receipts", name);
}

export async function storePrivatePixReceipt({ bytes, contentType, extension }) {
  const pathname = createReceiptStoragePath(extension);
  if (useVercelBlob()) {
    const { put } = await import("@vercel/blob");
    const blob = await put(pathname, bytes, {
      access: "private",
      addRandomSuffix: false,
      contentType,
    });
    return blob.url;
  }
  if (process.env.NODE_ENV === "production") throw new Error("Armazenamento privado de comprovantes não configurado.");
  const name = pathname.split("/").at(-1);
  const destination = localReceiptPath(`local:${name}`);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes, { flag: "wx" });
  return `local:${name}`;
}

export async function readPrivatePixReceipt(storageKey) {
  if (String(storageKey || "").startsWith("local:")) {
    return { body: await readFile(localReceiptPath(storageKey)) };
  }
  const { get } = await import("@vercel/blob");
  const result = await get(storageKey, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) return null;
  return { body: result.stream, contentType: result.blob.contentType, sizeBytes: result.blob.size };
}

export async function deletePrivatePixReceipt(storageKey) {
  if (!storageKey) return;
  if (String(storageKey).startsWith("local:")) {
    await rm(localReceiptPath(storageKey), { force: true });
    return;
  }
  const { del } = await import("@vercel/blob");
  await del(storageKey);
}
