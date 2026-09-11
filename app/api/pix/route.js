import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { appendAuditEvent, createSupportTicket } from "@/lib/db";
import { getOrganizationAccess } from "@/lib/organization-access";
import { formatCents } from "@/lib/pix";
import { createOrGetPixPaymentRequest, getLatestPixPayment } from "@/lib/pix-db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { guardMutation } from "@/lib/request-security";
import { reportServerError } from "@/lib/server-observability";
import { publicSupportContact } from "@/lib/support-contact";

export const runtime = "nodejs";

async function owner(request) {
  const user = await getSession(request, { allowInactiveSubscription: true });
  if (!user) return { response: NextResponse.json({ error: "Não autenticado" }, { status: 401 }) };
  if (!user.isBillingOwner) return { response: NextResponse.json({ error: "Somente o proprietário pode solicitar ou renovar o plano." }, { status: 403 }) };
  return { user };
}

function publicPayment(payment) {
  if (!payment) return null;
  return {
    ...payment,
    amount: formatCents(payment.amountCents),
    // Mantém compatibilidade com páginas antigas sem entregar instruções Pix.
    pixCode: null,
  };
}

export async function GET(request) {
  const limited = await enforceRateLimit(request, { scope: "pix-read", limit: 60 });
  if (limited) return limited;
  const auth = await owner(request);
  if (auth.response) return auth.response;
  return NextResponse.json({ payment: publicPayment(await getLatestPixPayment(auth.user.id)), contact: publicSupportContact() }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const limited = await enforceRateLimit(request, { scope: "pix-create", limit: 6 });
  if (limited) return limited;
  const auth = await owner(request);
  if (auth.response) return auth.response;
  try {
    const access = await getOrganizationAccess(auth.user);
    const result = await createOrGetPixPaymentRequest(auth.user.id);
    if (result.created) {
      await createSupportTicket({
        userId: auth.user.id,
        organizationId: access?.organizationId || null,
        subject: `Pagamento pelo suporte ${result.payment.txid}`,
        message: `Solicitação de orientações para pagamento de ${formatCents(result.payment.amountCents)}. Referência ${result.payment.txid}. Entre em contato com o cliente para combinar o pagamento; a solicitação não confirma recebimento.`,
        preferredChannel: "site",
      });
      await appendAuditEvent({
        userId: auth.user.id,
        actorUserId: auth.user.id,
        organizationId: access?.organizationId || null,
        action: "pix.payment_requested",
        origin: "api/pix",
        subjectType: "pix_payment_request",
        subjectId: result.payment.id,
        newState: { status: result.payment.status, kind: result.payment.kind, amountCents: result.payment.amountCents },
      });
    }
    return NextResponse.json({ payment: publicPayment(result.payment), contact: publicSupportContact(), created: result.created }, { status: result.created ? 201 : 200 });
  } catch (error) {
    reportServerError(error, { request, route: "/api/pix", operation: "create-payment" });
    return NextResponse.json({ error: "Não foi possível registrar a solicitação agora. Entre em contato com o suporte." }, { status: 500 });
  }
}
