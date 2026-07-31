const attempts = new Map();

export function allowAuthAttempt(request) {
  // TODO em produção distribuída, troque este Map por Redis/Upstash para limitar todas as instâncias.
  const key = request.headers.get("x-forwarded-for")?.split(",")[0] || "local";
  const now = Date.now();
  const item = attempts.get(key) || { count: 0, resetAt: now + 60_000 };
  if (now > item.resetAt) { item.count = 0; item.resetAt = now + 60_000; }
  item.count += 1;
  attempts.set(key, item);
  return item.count <= 10;
}
