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
