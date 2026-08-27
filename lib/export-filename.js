const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const CONTROL_OR_PATH = /[\u0000-\u001f\u007f<>:"/\\|?*]/g;

function normalizedExtension(extension) {
  return String(extension || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 10);
}

export function exportFileBase(value, extension = "") {
  const ext = normalizedExtension(extension);
  let base = String(value || "").normalize("NFKC").trim();
  if (ext) base = base.replace(new RegExp(`\\.${ext}$`, "i"), "");
  return base;
}

export function exportFileNameError(value) {
  const base = String(value || "").trim();
  if (!base) return "Informe um nome para o arquivo.";
  if (CONTROL_OR_PATH.test(base)) {
    CONTROL_OR_PATH.lastIndex = 0;
    return 'O nome não pode conter / \\ : * ? " < > | nem quebras de linha.';
  }
  CONTROL_OR_PATH.lastIndex = 0;
  if (/^[. ]+$/.test(base)) return "Use pelo menos uma letra ou número no nome.";
  if (WINDOWS_RESERVED.test(base)) return "Este nome é reservado pelo sistema. Escolha outro.";
  return "";
}

export function safeExportFilename(value, extension, fallbackBase = "arquivo-candtech") {
  const ext = normalizedExtension(extension) || "bin";
  const safeFallback = exportFileBase(fallbackBase, ext) || "arquivo-candtech";
  let base = exportFileBase(value, ext)
    .replace(CONTROL_OR_PATH, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .replace(/^[. -]+|[. -]+$/g, "")
    .slice(0, 100)
    .replace(/[. ]+$/g, "");
  if (!base || WINDOWS_RESERVED.test(base)) {
    base = safeFallback
      .replace(CONTROL_OR_PATH, "-")
      .replace(/^[. -]+|[. -]+$/g, "")
      .slice(0, 100) || "arquivo-candtech";
  }
  return `${base}.${ext}`;
}

export function attachmentContentDisposition(filename) {
  const safeName = String(filename || "arquivo-candtech.bin").replace(/[\r\n]/g, "");
  const asciiName = safeName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "-")
    .replace(/["\\]/g, "-");
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}
