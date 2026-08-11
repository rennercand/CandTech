import { findOrganizationAccess, getBillingProviderState } from "./db.js";

export function billingEnforcementEnabled() {
  return String(process.env.BILLING_ENFORCEMENT_ENABLED || "").toLowerCase() === "true";
}

export function isSubscriptionActive(status) {
  return status === "active";
}

export async function getBillingAccess(userId) {
  const access = await findOrganizationAccess(userId);
  const ownerUserId = Number(access?.ownerUserId || userId);
  const billing = await getBillingProviderState(ownerUserId);
  const required = billingEnforcementEnabled();
  return {
    required,
    active: !required || isSubscriptionActive(billing.status),
    ownerUserId,
    isBillingOwner: ownerUserId === Number(userId),
    status: billing.status,
  };
}
