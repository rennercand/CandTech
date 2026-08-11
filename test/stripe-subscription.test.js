import test from "node:test";
import assert from "node:assert/strict";
import { invoiceSubscriptionId, localSubscriptionStatus, stripeObjectId, subscriptionPriceId, subscriptionUserId } from "../lib/stripe-subscription.js";

test("assinatura Stripe só ativa estados pagos ou em período de teste", () => {
  assert.equal(localSubscriptionStatus("active"), "active");
  assert.equal(localSubscriptionStatus("trialing"), "active");
  assert.equal(localSubscriptionStatus("past_due"), "past_due");
  assert.equal(localSubscriptionStatus("canceled"), "canceled");
  assert.equal(localSubscriptionStatus("incomplete"), "pending");
});

test("metadados Stripe exigem usuário numérico e preservam IDs esperados", () => {
  const subscription = { metadata: { candtech_user_id: "42" }, customer: { id: "cus_test" }, items: { data: [{ price: { id: "price_test" } }] } };
  assert.equal(subscriptionUserId(subscription), 42);
  assert.equal(subscriptionUserId({ metadata: { candtech_user_id: "../../admin" } }), null);
  assert.equal(stripeObjectId(subscription.customer), "cus_test");
  assert.equal(subscriptionPriceId(subscription), "price_test");
  assert.equal(invoiceSubscriptionId({ parent: { subscription_details: { subscription: "sub_test" } } }), "sub_test");
});
