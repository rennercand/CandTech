import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDatabaseForTests, createUser, getBillingProfile, getBillingProviderState, hasProcessedStripeEvent, recordStripeEvent, updateStripeSubscription } from "../lib/db.js";

test("webhook Stripe atualiza assinatura e deduplica eventos sem armazenar cartão", async () => {
  const directory = mkdtempSync(join(tmpdir(), "candtech-stripe-"));
  const previousEnvironment = process.env.NODE_ENV;
  const previousPath = process.env.SQLITE_DATABASE_PATH;
  process.env.NODE_ENV = "test";
  process.env.SQLITE_DATABASE_PATH = join(directory, "stripe.sqlite");
  try {
    const user = await createUser({ name: "Assinante", email: "stripe@teste.local", passwordHash: "hash", accountType: "company" });
    await updateStripeSubscription({ userId: user.id, customerId: "cus_test", subscriptionId: "sub_test", priceId: "price_test", status: "active", currentPeriodEnd: "2026-09-11T00:00:00.000Z" });
    assert.deepEqual(await getBillingProviderState(user.id), {
      paymentProvider: "stripe", customerId: "cus_test", subscriptionId: "sub_test", priceId: "price_test", status: "active", currentPeriodEnd: "2026-09-11T00:00:00.000Z",
    });
    assert.equal((await getBillingProfile(user.id)).accountType, "company");
    assert.equal(await hasProcessedStripeEvent("evt_test"), false);
    await recordStripeEvent({ eventId: "evt_test", eventType: "customer.subscription.updated" });
    await recordStripeEvent({ eventId: "evt_test", eventType: "customer.subscription.updated" });
    assert.equal(await hasProcessedStripeEvent("evt_test"), true);
  } finally {
    await closeDatabaseForTests();
    if (previousEnvironment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnvironment;
    if (previousPath === undefined) delete process.env.SQLITE_DATABASE_PATH; else process.env.SQLITE_DATABASE_PATH = previousPath;
    rmSync(directory, { recursive: true, force: true });
  }
});
