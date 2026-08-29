import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { appendAuditEvent, createSupportTicket } from "@/lib/db";
import { getOrganizationAccess } from "@/lib/organization-access";
import { buildPixPayload, formatCents, pixSettings } from "@/lib/pix";
import { createOrGetPixPaymentRequest, getLatestPixPayment } from "@/lib/pix-db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { guardMutation } from "@/lib/request-security";
import { reportServerError } from "@/lib/server-observability";
import { publicSupportContact } from "@/lib/support-contact";

export const runtime = "nodejs";

const PIX_CONFIGURATION_MESSAGES = {
  PIX_KEY_MISSING: "A variável PIX_KEY está vazia ou não chegou ao ambiente Production da Vercel.",
  PIX_KEY_TOO_LONG: "A variável PIX_KEY ultrapassa 77 caracteres. Cole somente a chave aleatória, não o Pix Copia e Cola completo.",
  PIX_KEY_INVALID_CHARACTERS: "A variável PIX_KEY contém caractere inválido. Copie novamente somente a chave aleatória cadastrada no banco.",
  PIX_RECEIVER_NAME_MISSING: "Preencha PIX_RECEIVER_NAME no ambiente Production da Vercel.",
  PIX_RECEIVER_CITY_MISSING: "Preencha PIX_RECEIVER_CITY no ambiente Production da Vercel.",
};

async function owner(request) {
  const user = await getSession(request, { allowInactiveSubscription: true });
  if (!user) return { response: NextResponse.json({ error: "Não autenticado" }, { status: 401 }) };
  if (!user.isBillingOwner) return { response: NextResponse.json({ error: "Somente o proprietário pode solicitar ou renovar o plano." }, { status: 403 }) };
  return { user };
}

function publicPayment(payment) {
  if (!payment) return null;
  const settings = pixSettings();
  return {
    ...payment,
    amount: formatCents(payment.amountCents),
    pixCode: payment.status === "pending" && settings.configured ? buildPixPayload({ ...settings, amountCents: payment.amountCents, txid: payment.txid }) : null,
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
  const settings = pixSettings();
  if (!settings.configured) {
    console.warn(JSON.stringify({ event: "pix.configuration_invalid", issue: settings.configurationIssue }));
    return NextResponse.json({
      error: PIX_CONFIGURATION_MESSAGES[settings.configurationIssue] || "O Pix ainda está sendo configurado.",
      code: settings.configurationIssue || "PIX_NOT_CONFIGURED",
    }, { status: 503 });
  }
  try {
    const access = await getOrganizationAccess(auth.user);
    const result = await createOrGetPixPaymentRequest(auth.user.id);
    if (result.created) {
      await createSupportTicket({
        userId: auth.user.id,
        organizationId: access?.organizationId || null,
        subject: `Pagamento Pix ${result.payment.txid}`,
        message: `Nova solicitação Pix de ${formatCents(result.payment.amountCents)}. Referência ${result.payment.txid}. Aguardando conferência manual do pagamento.`,
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
    return NextResponse.json({ error: "Não foi possível gerar o Pix agora." }, { status: 500 });
  }
}
