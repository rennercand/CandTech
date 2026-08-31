import { createHash } from "node:crypto";

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

export function normalizeIdempotencyKey(value) {
  const key = String(value || "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(key) ? key : null;
}

export function hashIdempotencyValue(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

export function hashIdempotencyRequest(value) {
  return hashIdempotencyValue(JSON.stringify(canonicalValue(value)));
}
