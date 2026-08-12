import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getBillingProviderState } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { guardMutation } from "@/lib/request-security";
import { getStripe, publicAppUrl, stripePriceId, stripeSetupPriceId } from "@/lib/stripe";
import { reportServerError } from "@/lib/server-observability";

export const runtime = "nodejs";

export async function POST(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const user = await getSession(request, { allowInactiveSubscription: true });
  if (user && !user.isBillingOwner) return NextResponse.json({ error: "Somente o responsável pela empresa pode contratar a assinatura." }, { status: 403 });
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const limited = await enforceRateLimit(request, { scope: "stripe-checkout", limit: 8, identifier: user.id });
  if (limited) return limited;
  try {
    const billing = await getBillingProviderState(user.id);
    if (billing.paymentProvider === "stripe" && billing.subscriptionId && !["canceled", "not_subscriber"].includes(billing.status)) {
      return NextResponse.json({ error: "Esta conta já possui uma assinatura. Use Gerenciar assinatura." }, { status: 409 });
    }
    const priceId = stripePriceId();
    const setupPriceId = stripeSetupPriceId();
    const stripe = getStripe();
    const baseUrl = publicAppUrl();
    const customer = billing.paymentProvider === "stripe" && billing.customerId ? { customer: billing.customerId } : { customer_email: user.email };
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      ...customer,
      client_reference_id: String(user.id),
      // O preço avulso aparece somente na primeira fatura; as renovações
      // seguintes contêm apenas a assinatura mensal.
      line_items: [
        { price: priceId, quantity: 1 },
        { price: setupPriceId, quantity: 1 },
      ],
      success_url: `${baseUrl}/assinar?checkout=success`,
      cancel_url: `${baseUrl}/assinar?checkout=cancelled`,
      locale: "pt-BR",
      billing_address_collection: "auto",
      integration_identifier: "candtech_hqrmxvpa",
      metadata: { candtech_user_id: String(user.id), candtech_price_id: priceId, candtech_setup_price_id: setupPriceId },
      subscription_data: { metadata: { candtech_user_id: String(user.id), candtech_price_id: priceId } },
    }, { idempotencyKey: `checkout-${user.id}-${priceId}-${setupPriceId}-${Math.floor(Date.now() / 300_000)}` });
    if (!session.url) throw new Error("Stripe não retornou URL de checkout");
    return NextResponse.json({ url: session.url });
  } catch (error) {
    reportServerError(error, { request, route: "/api/stripe/checkout", operation: "create-checkout" });
    const configurationError = /STRIPE_|PUBLIC_APP_URL/.test(String(error?.message || ""));
    return NextResponse.json({ error: configurationError ? "A cobrança Stripe ainda está sendo configurada." : "Não foi possível abrir o checkout seguro." }, { status: configurationError ? 503 : 502 });
  }
}
