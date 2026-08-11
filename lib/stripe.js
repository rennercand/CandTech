import Stripe from "stripe";

let stripeClient;

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} não configurado`);
  return value;
}

export function getStripe() {
  const secretKey = required("STRIPE_SECRET_KEY");
  if (!/^[sr]k_(test|live)_[A-Za-z0-9]+$/.test(secretKey)) throw new Error("STRIPE_SECRET_KEY inválida");
  if (process.env.VERCEL_ENV === "production" && secretKey.includes("_test_")) throw new Error("Chave Stripe de teste não pode ser usada em Production");
  if (["preview", "development"].includes(process.env.VERCEL_ENV) && secretKey.includes("_live_")) throw new Error("Chave Stripe live não pode ser usada fora de Production");
  if (!stripeClient) stripeClient = new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 10_000 });
  return stripeClient;
}

export function stripePriceId() {
  const value = required("STRIPE_PRICE_ID");
  if (!/^price_[A-Za-z0-9]+$/.test(value)) throw new Error("STRIPE_PRICE_ID inválido");
  return value;
}

export function stripeWebhookSecret() {
  const value = required("STRIPE_WEBHOOK_SECRET");
  if (!value.startsWith("whsec_")) throw new Error("STRIPE_WEBHOOK_SECRET inválido");
  return value;
}

export function publicAppUrl() {
  const value = required("PUBLIC_APP_URL").replace(/\/+$/, "");
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("PUBLIC_APP_URL deve usar HTTPS");
  return url.origin;
}
