import { createHash } from "node:crypto";
import { consumeRateLimit } from "@/lib/db";

function clientAddress(request) {
  // A Vercel preenche x-forwarded-for; somente o primeiro endereço representa o cliente.
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

export async function enforceRateLimit(
  request,
  { scope = "api", limit = 120, windowMs = 60_000 } = {},
) {
  // O IP é transformado em hash para não ser gravado em texto puro na tabela de controle.
  const identity = createHash("sha256")
    .update(`${scope}:${clientAddress(request)}`)
    .digest("hex");
  const result = await consumeRateLimit({ key: identity, limit, windowMs });
  if (result.allowed) return null;

  const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
  return Response.json(
    { error: "Muitas requisições. Aguarde e tente novamente." },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
        "X-RateLimit-Limit": String(limit),
        "X-RateLimit-Remaining": "0",
      },
    },
  );
}
