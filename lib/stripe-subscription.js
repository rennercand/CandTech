export const ACTIVE_STRIPE_STATUSES = new Set(["active", "trialing"]);

export function localSubscriptionStatus(stripeStatus) {
  if (ACTIVE_STRIPE_STATUSES.has(stripeStatus)) return "active";
  if (["past_due", "unpaid"].includes(stripeStatus)) return "past_due";
  if (["canceled", "incomplete_expired"].includes(stripeStatus)) return "canceled";
  if (stripeStatus === "paused") return "paused";
  return "pending";
}

export function stripeObjectId(value) {
  return typeof value === "string" ? value : value?.id || "";
}

export function subscriptionUserId(subscription) {
  const value = Number(subscription?.metadata?.candtech_user_id);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function subscriptionPriceId(subscription) {
  return subscription?.items?.data?.[0]?.price?.id || "";
}

export function invoiceSubscriptionId(invoice) {
  return stripeObjectId(invoice?.subscription || invoice?.parent?.subscription_details?.subscription);
}
