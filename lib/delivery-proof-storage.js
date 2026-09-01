import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

function useVercelBlob() {
  return process.env.VERCEL === "1" || Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

function localPath(storageKey) {
  const name = String(storageKey || "").replace(/^local:delivery-proof:/, "");
  if (!/^[0-9a-f-]{36}\.(pdf|jpg|png|webp)$/i.test(name)) throw new Error("Referência de comprovante inválida.");
  return path.join(process.cwd(), "data", "delivery-proofs", name);
}

export async function storeDeliveryProof({ bytes, contentType, extension }) {
  const name = `${randomUUID()}.${extension}`;
  if (useVercelBlob()) {
    const { put } = await import("@vercel/blob");
    const blob = await put(`delivery-proofs/${name}`, bytes, { access: "private", addRandomSuffix: false, contentType });
    return blob.url;
  }
  if (process.env.NODE_ENV === "production") throw new Error("Armazenamento privado não configurado.");
  const destination = localPath(`local:delivery-proof:${name}`);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes, { flag: "wx" });
  return `local:delivery-proof:${name}`;
}

export async function readDeliveryProof(storageKey) {
  if (String(storageKey || "").startsWith("local:delivery-proof:")) return { body: await readFile(localPath(storageKey)) };
  const { get } = await import("@vercel/blob");
  const result = await get(storageKey, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) return null;
  return { body: result.stream, contentType: result.blob.contentType, sizeBytes: result.blob.size };
}

export async function deleteDeliveryProof(storageKey) {
  if (!storageKey) return;
  if (String(storageKey).startsWith("local:delivery-proof:")) return rm(localPath(storageKey), { force: true });
  const { del } = await import("@vercel/blob");
  await del(storageKey);
}
