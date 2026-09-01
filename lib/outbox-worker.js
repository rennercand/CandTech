import { claimOutboxEvents, publishOutboxEvent, retryOutboxEvent } from "./idempotency-db.js";

const INTERNAL_EVENTS = new Set([
  "history.created", "history.updated", "inventory.order.sale", "inventory.order.purchase",
]);

export async function processOutboxBatch({ limit = 25 } = {}) {
  const events = await claimOutboxEvents({ limit });
  let published = 0;
  let failed = 0;
  for (const event of events) {
    try {
      if (!INTERNAL_EVENTS.has(event.event_type)) throw Object.assign(new Error("unsupported"), { code: "UNSUPPORTED_EVENT_TYPE" });
      if (!await publishOutboxEvent(event.public_id)) throw Object.assign(new Error("claim_lost"), { code: "OUTBOX_CLAIM_LOST" });
      published += 1;
    } catch (error) {
      await retryOutboxEvent(event.public_id, error?.code || "PROCESSING_FAILED", event.attempts);
      failed += 1;
    }
  }
  return { claimed: events.length, published, failed };
}
