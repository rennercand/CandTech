import { findOrganizationAccess, getBillingProviderState } from "./db.js";

export function billingEnforcementEnabled() {
  // Em produção o ERP é privado por padrão: cadastro, geração de Pix e envio de
  // comprovante nunca liberam acesso. Somente uma assinatura marcada como
  // `active` pelo fluxo administrativo pode liberar a organização.
  if (String(process.env.VERCEL_ENV || "").toLowerCase() === "production") return true;
  return String(process.env.BILLING_ENFORCEMENT_ENABLED || "").toLowerCase() === "true";
}

export function isSubscriptionActive(status) {
  return status === "active";
}

/**
 * Resolve a cobrança pela conta proprietária da organização. Funcionários não
 * possuem uma assinatura separada: eles herdam o estado pago da empresa.
 *
 * Em produção o enforcement é obrigatório. O usuário pode autenticar-se em
 * fluxos explicitamente marcados com `allowInactiveSubscription` (ex.: página
 * de assinatura e central administrativa), mas o ERP operacional exige estado
 * `active`, que só é produzido após revisão manual do pagamento.
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
