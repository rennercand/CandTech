export function guardMutation(request) {
  // Navegadores modernos informam se a chamada partiu de outro site.
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && !["same-origin", "none"].includes(fetchSite)) {
    return Response.json({ error: "Origem não autorizada." }, { status: 403 });
  }

  // Quando Origin está presente, ele deve ser exatamente o mesmo da API chamada.
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: "Origem não autorizada." }, { status: 403 });
  }

  // As rotas com corpo aceitam somente JSON, reduzindo formatos inesperados.
  if (!["GET", "HEAD", "DELETE"].includes(request.method)) {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
      return Response.json({ error: "Formato de conteúdo inválido." }, { status: 415 });
    }
  }

  return null;
}

export class RequestBodyError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "RequestBodyError";
    this.status = status;
  }
}

// Lê o fluxo em blocos e interrompe antes que um JSON excessivo seja carregado
// por inteiro na memória. O Content-Length é apenas uma rejeição antecipada;
// o limite abaixo continua valendo quando o cabeçalho está ausente ou incorreto.
export async function readLimitedJson(
  request,
  { maxBytes = 8_192, maxDepth = 8, maxNodes = 200, maxStringLength = 2_048 } = {},
) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > maxBytes) throw new RequestBodyError("Conteúdo muito grande.", 413);
  if (!request.body) throw new RequestBodyError("Corpo JSON ausente.");

  const reader = request.body.getReader();
  const chunks = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel("body-limit").catch(() => null);
        throw new RequestBodyError("Conteúdo muito grande.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let data;
  try {
    data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new RequestBodyError("JSON inválido.");
  }

  let nodes = 0;
  const inspect = (value, depth) => {
    nodes += 1;
    if (nodes > maxNodes || depth > maxDepth) throw new RequestBodyError("Estrutura JSON muito complexa.");
    if (typeof value === "string" && value.length > maxStringLength) {
      throw new RequestBodyError("Campo de texto muito grande.");
    }
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item) => inspect(item, depth + 1));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) {
        throw new RequestBodyError("Campo não permitido.");
      }
      inspect(child, depth + 1);
    }
  };
  inspect(data, 0);
  return data;
}

export function requestBodyErrorResponse(error) {
  if (!(error instanceof RequestBodyError)) return null;
  return Response.json({ error: error.message }, { status: error.status });
}
