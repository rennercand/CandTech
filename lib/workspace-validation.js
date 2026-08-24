const TRAVERSAL_PATTERN = /(?:^|[\\/])\.\.(?:[\\/]|$)|(?:%2e){2}(?:%2f|%5c)|^[A-Za-z]:[\\/]|^\\\\/i;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

export function validateWorkspacePayload(payload, { maxSerializedLength = 500_000 } = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;

  let serialized;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    return false;
  }
  if (serialized.length > maxSerializedLength) return false;

  if (payload.organizationName !== undefined) {
    if (typeof payload.organizationName !== "string") return false;
    const organizationName = payload.organizationName.normalize("NFKC").trim();
    if (!organizationName || organizationName.length > 120) return false;
    // O nome nunca é usado como caminho. Rejeitar sintaxe de caminho torna
    // essa garantia explícita e evita que scanners confundam texto refletido
    // com tentativa de leitura de arquivos.
    if (CONTROL_CHARACTER_PATTERN.test(organizationName) || TRAVERSAL_PATTERN.test(organizationName)) return false;
  }

  return true;
}
