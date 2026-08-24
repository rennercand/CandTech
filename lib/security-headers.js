const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export function buildContentSecurityPolicy(nonce, { development = process.env.NODE_ENV === "development" } = {}) {
  if (!NONCE_PATTERN.test(String(nonce || ""))) {
    throw new TypeError("Nonce CSP inválido.");
  }

  const scriptSources = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(development ? ["'unsafe-eval'"] : []),
    // Mantido como fallback para navegadores antigos sem strict-dynamic.
    "https://www.googletagmanager.com",
  ];

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `script-src ${scriptSources.join(" ")}`,
    `style-src 'self' 'nonce-${nonce}'`,
    // Os gráficos usam somente valores numéricos calculados pela aplicação em
    // atributos style. Blocos <style> continuam exigindo o nonce da requisição.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.google-analytics.com https://*.googletagmanager.com",
    "font-src 'self' data:",
    "connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}
