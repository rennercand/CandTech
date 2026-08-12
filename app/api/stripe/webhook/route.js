import { NextResponse } from "next/server";
import { appendAuditEvent, hasProcessedStripeEvent, recordStripeEvent, updateStripeSubscription } from "@/lib/db";
import { getStripe, stripePriceId, stripeWebhookSecret } from "@/lib/stripe";
import { invoiceSubscriptionId, localSubscriptionStatus, stripeObjectId, subscriptionPriceId, subscriptionUserId } from "@/lib/stripe-subscription";
import { reportServerError } from "@/lib/server-observability";

export const runtime = "nodejs";
const MAX_WEBHOOK_BYTES = 1_048_576;

async function applySubscription(subscription) {
  const userId = subscriptionUserId(subscription);
  const priceId = subscriptionPriceId(subscription);
  const customerId = stripeObjectId(subscription.customer);
  if (!userId || !/^cus_/.test(customerId) || !/^sub_/.test(subscription.id || "") || priceId !== stripePriceId()) return false;
  const status = localSubscriptionStatus(subscription.status);
  const currentPeriodEnd = subscription.current_period_end || subscription.items?.data?.[0]?.current_period_end;
  const periodEnd = Number(currentPeriodEnd) > 0 ? new Date(currentPeriodEnd * 1_000).toISOString() : null;
  await updateStripeSubscription({
    userId,
    customerId,
    subscriptionId: subscription.id,
    priceId,
    status,
    currentPeriodEnd: periodEnd,
  });
  await appendAuditEvent({ userId, action: "subscription.updated", metadata: { provider: "stripe", status } });
  return true;
}

async function applyLatestSubscription(subscriptionOrId) {
  const subscriptionId = stripeObjectId(subscriptionOrId);
  if (!/^sub_[A-Za-z0-9]+$/.test(subscriptionId)) return false;
  // A Stripe não garante a ordem de entrega dos webhooks. Consultar o objeto
  // atual impede que um evento atrasado reverta um pagamento ou cancelamento
  // mais recente já registrado na conta.
  const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
  return applySubscription(subscription);
}

export async function POST(request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_WEBHOOK_BYTES) return NextResponse.json({ error: "Payload muito grande" }, { status: 413 });
  let rawBody;
  try {
    rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BYTES) return NextResponse.json({ error: "Payload muito grande" }, { status: 413 });
    const signature = request.headers.get("stripe-signature");
    if (!signature) return NextResponse.json({ error: "Assinatura ausente" }, { status: 400 });
    const event = getStripe().webhooks.constructEvent(rawBody, signature, stripeWebhookSecret());
    if (await hasProcessedStripeEvent(event.id)) return NextResponse.json({ received: true, duplicate: true });

    if (event.type === "checkout.session.completed") {
      const subscriptionId = stripeObjectId(event.data.object.subscription);
      if (subscriptionId) await applyLatestSubscription(subscriptionId);
    } else if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
      await applyLatestSubscription(event.data.object);
    } else if (["invoice.paid", "invoice.payment_failed"].includes(event.type)) {
      const subscriptionId = invoiceSubscriptionId(event.data.object);
      if (subscriptionId) await applyLatestSubscription(subscriptionId);
    }
    await recordStripeEvent({ eventId: event.id, eventType: event.type });
    return NextResponse.json({ received: true });
  } catch (error) {
    reportServerError(error, { request, route: "/api/stripe/webhook", operation: "process-webhook" });
    const signatureError = error?.type === "StripeSignatureVerificationError";
    return NextResponse.json({ error: signatureError ? "Assinatura inválida" : "Falha ao processar evento" }, { status: signatureError ? 400 : 500 });
  }
}
