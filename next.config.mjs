const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig = {
  // Evita divulgar a tecnologia do servidor no cabeçalho X-Powered-By.
  poweredByHeader: false,
  async headers() {
    // Os cabeçalhos são aplicados a páginas, APIs e arquivos servidos pelo Next.js.
    return [
      {
        source: "/",
        headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0" }],
      },
      {
        // APIs e a central privada nunca devem ser armazenadas pelo navegador,
        // CDN ou proxy intermediário, mesmo quando a resposta for um erro.
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0" }],
      },
      {
        source: "/central/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0" }],
      },
      // A CSP de páginas é criada no proxy com nonce único por requisição.
      // Os demais cabeçalhos continuam válidos para páginas, APIs e estáticos.
      { source: "/(.*)", headers: securityHeaders },
    ];
  },
};

export default nextConfig;
