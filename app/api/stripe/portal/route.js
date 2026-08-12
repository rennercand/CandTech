import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getBillingProviderState } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { guardMutation } from "@/lib/request-security";
import { getStripe, publicAppUrl } from "@/lib/stripe";
import { reportServerError } from "@/lib/server-observability";

export const runtime = "nodejs";

export async function POST(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const user = await getSession(request, { allowInactiveSubscription: true });
  if (user && !user.isBillingOwner) return NextResponse.json({ error: "Somente o responsável pela empresa pode gerenciar a assinatura." }, { status: 403 });
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const limited = await enforceRateLimit(request, { scope: "stripe-portal", limit: 12, identifier: user.id });
  if (limited) return limited;
  try {
    const billing = await getBillingProviderState(user.id);
    if (billing.paymentProvider !== "stripe" || !billing.customerId) {
      return NextResponse.json({ error: "Nenhuma assinatura Stripe vinculada a esta conta." }, { status: 404 });
    }
    const session = await getStripe().billingPortal.sessions.create({ customer: billing.customerId, return_url: `${publicAppUrl()}/assinar` });
    return NextResponse.json({ url: session.url });
  } catch (error) {
    reportServerError(error, { request, route: "/api/stripe/portal", operation: "create-portal" });
    return NextResponse.json({ error: "Não foi possível abrir o gerenciamento da assinatura." }, { status: 502 });
  }
}
