const TRAVERSAL_PATTERN = /(?:^|[\\/])\.\.(?:[\\/]|$)|(?:%2e){2}(?:%2f|%5c)|^[A-Za-z]:[\\/]|^\\\\/i;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const DECIMAL_INPUT_PATTERN = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/;

function hasValidNumericFields(value) {
  if (!value || typeof value !== "object") return true;

  for (const [key, child] of Object.entries(value)) {
    // Os formulários React mantêm números como texto enquanto são editados.
    // A taxa, porém, nunca pode ser texto livre: isso evita armazenar payloads
    // de scanner como `' OR '1'='1'--` em um campo exclusivamente numérico.
    if (key === "rate") {
      const validNumber = typeof child === "number" && Number.isFinite(child);
      const validDraft = typeof child === "string" && (
        child === "" || DECIMAL_INPUT_PATTERN.test(child.trim())
      );
      if (!validNumber && !validDraft) return false;
    }

    if (!hasValidNumericFields(child)) return false;
  }

  return true;
}

export function validateWorkspacePayload(payload, { maxSerializedLength = 500_000 } = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;

  let serialized;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    return false;
  }
  if (serialized.length > maxSerializedLength) return false;
  if (!hasValidNumericFields(payload)) return false;

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
