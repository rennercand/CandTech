function redactErrorMessage(value) {
  return String(value || "Erro sem mensagem")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b(?:re_|sk[-_]|Bearer\s+)[A-Za-z0-9._-]{8,}/gi, "[credencial]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[token]")
    .replace(/\b\d{11,14}\b/g, "[documento]")
    .slice(0, 500);
}

export function reportServerError(error, { request, route, operation, status = 500, startedAt } = {}) {
  const duration = Number.isFinite(startedAt) ? Date.now() - startedAt : undefined;
  const payload = {
    level: "error",
    message: "server_operation_failed",
    route: String(route || "unknown").slice(0, 120),
    operation: String(operation || "unknown").slice(0, 80),
    status,
    requestId: request?.headers?.get?.("x-vercel-id") || request?.headers?.get?.("x-request-id") || undefined,
    durationMs: duration,
    errorName: String(error?.name || "Error").slice(0, 80),
    errorCode: /^[A-Z0-9_]{2,80}$/.test(String(error?.code || "")) ? error.code : undefined,
    // Em produção, evita registrar valores de negócio que uma mensagem de banco possa conter.
    errorMessage: process.env.NODE_ENV === "production" ? undefined : redactErrorMessage(error?.message || error),
  };
  console.error(JSON.stringify(Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined))));
}

export function reportClientBoundary(error, boundary) {
  // Não envia mensagem, formulário, e-mail ou conteúdo do workspace ao console.
  console.error(JSON.stringify({
    level: "error",
    message: "ui_error_boundary",
    boundary,
    digest: String(error?.digest || "").slice(0, 100) || undefined,
    errorName: String(error?.name || "Error").slice(0, 80),
  }));
}
