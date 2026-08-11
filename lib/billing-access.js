import { findOrganizationAccess, getBillingProviderState } from "./db.js";

export function billingEnforcementEnabled() {
  return String(process.env.BILLING_ENFORCEMENT_ENABLED || "").toLowerCase() === "true";
}

export function isSubscriptionActive(status) {
  return status === "active";
}

/**
 * Resolve a cobrança pela conta proprietária da organização. Funcionários não
 * possuem uma assinatura separada: eles herdam o estado pago da empresa.
 * A flag de enforcement permite implantar e testar a integração antes de
 * transformar ausência de pagamento em bloqueio de acesso.
 */
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
