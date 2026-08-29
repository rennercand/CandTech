import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getAdministratorAccess } from "@/lib/admin-access";
import { appendAuditEvent, listMonitoringEvents, listSupportTicketsForAdmin, replySupportTicket, updateMonitoringEventStatus } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { guardMutation, readLimitedJson, requestBodyErrorResponse } from "@/lib/request-security";
import { reportServerError } from "@/lib/server-observability";
import { listPaymentsForPrivateCentral } from "@/lib/admin-payment-list";
import { reviewPixPaymentManually } from "@/lib/manual-payment-review";
import { processPixExpirations } from "@/lib/pix-expiration";

export const runtime = "nodejs";

async function authorize(request) {
  const user = await getSession(request, { allowInactiveSubscription: true });
  if (!user) return { response: NextResponse.json({ error: "Não autenticado" }, { status: 401 }) };
  if (!user.legalAccepted) return { response: NextResponse.json({ error: "Aceite jurídico pendente." }, { status: 403 }) };
  const access = await getAdministratorAccess(user);
  if (!access.isStaff) return { response: NextResponse.json({ error: "Acesso restrito" }, { status: 403 }) };
  return { user, access };
}

export async function GET(request) {
  const limited = await enforceRateLimit(request, { scope: "admin-monitoring", limit: 60 });
  if (limited) return limited;
  const auth = await authorize(request);
  if (auth.response) return auth.response;
  try {
    const [events, tickets, payments] = await Promise.all([
      auth.access.canMonitor ? listMonitoringEvents() : [],
      auth.access.canSupport ? listSupportTicketsForAdmin() : [],
      auth.access.canBilling ? listPaymentsForPrivateCentral() : [],
    ]);
    return NextResponse.json({
      events,
      tickets,
      payments,
      permissions: auth.access,
      totals: {
        openEvents: events.filter((item) => item.status !== "resolved").length,
        criticalEvents: events.filter((item) => item.level === "error" && item.status !== "resolved").length,
        openTickets: tickets.filter((item) => item.status === "open").length,
        pendingPayments: payments.filter((item) => ["pending", "payment_review"].includes(item.status)).length,
        reviewPayments: payments.filter((item) => item.status === "payment_review").length,
      },
      checkedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    reportServerError(error, { request, route: "/api/admin/monitoring", operation: "list" });
    return NextResponse.json({ error: "Não foi possível consultar o monitoramento." }, { status: 500 });
  }
}

export async function PATCH(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const limited = await enforceRateLimit(request, { scope: "admin-monitoring-update", limit: 30 });
  if (limited) return limited;
  const auth = await authorize(request);
  if (auth.response) return auth.response;
  try {
    const body = await readLimitedJson(request, { maxBytes: 8_192, maxStringLength: 4_000 });
    if (body.type === "event") {
      if (!auth.access.canMonitor) return NextResponse.json({ error: "Sem permissão para incidentes." }, { status: 403 });
      const previousEvent = (await listMonitoringEvents()).find((item) => item.id === String(body.id || "")) || null;
      const event = await updateMonitoringEventStatus({ id: String(body.id || ""), status: body.status });
      if (!event) return NextResponse.json({ error: "Incidente não encontrado." }, { status: 404 });
      await appendAuditEvent({
        userId: auth.user.id, actorUserId: auth.user.id, action: "monitoring.event_updated",
        origin: "api/admin/monitoring", subjectType: "monitoring_event", subjectId: event.id,
        previousState: previousEvent && { status: previousEvent.status }, newState: { status: event.status },
      });
      return NextResponse.json({ event });
    }
    if (body.type === "ticket") {
      if (!auth.access.canSupport) return NextResponse.json({ error: "Sem permissão para chamados." }, { status: 403 });
      const reply = String(body.reply || "").trim().slice(0, 4_000);
      if (reply.length < 2) return NextResponse.json({ error: "Escreva uma resposta." }, { status: 400 });
      const previousTicket = (await listSupportTicketsForAdmin()).find((item) => item.id === String(body.id || "")) || null;
      const ticket = await replySupportTicket({ id: String(body.id || ""), reply, status: body.status });
      if (!ticket) return NextResponse.json({ error: "Mensagem não encontrada." }, { status: 404 });
      await appendAuditEvent({
        userId: auth.user.id,
        actorUserId: auth.user.id,
        action: "support.ticket_replied",
        origin: "api/admin/monitoring",
        subjectType: "support_ticket",
        subjectId: ticket.id,
        previousState: previousTicket && { status: previousTicket.status, answered: Boolean(previousTicket.reply) },
        newState: { status: ticket.status, answered: true },
      });
      return NextResponse.json({ ticket });
    }
    if (body.type === "payment") {
      if (!auth.access.canBilling) return NextResponse.json({ error: "Sem permissão para pagamentos." }, { status: 403 });
      if (!["approve", "reject"].includes(body.action)) return NextResponse.json({ error: "Ação de pagamento inválida." }, { status: 400 });
      const payment = await reviewPixPaymentManually({ id: String(body.id || ""), approved: body.action === "approve", administratorId: auth.user.id });
      if (!payment) return NextResponse.json({ error: "Pagamento pendente não encontrado." }, { status: 404 });
      await appendAuditEvent({
        userId: payment.userId,
        actorUserId: auth.user.id,
        organizationId: payment.organizationId,
        action: body.action === "approve" ? "pix.payment_approved" : "pix.payment_rejected",
        origin: "api/admin/monitoring",
        subjectType: "pix_payment_request",
        subjectId: payment.id,
        previousState: { status: "payment_review" },
        newState: { status: payment.status, review: body.action },
        metadata: {
          paymentId: payment.id,
          administratorId: auth.user.id,
          approvalMode: "manual_admin",
          receiptRequired: false,
          receiptPresent: Boolean(payment.receipt),
        },
      });
      if (body.action === "reject") await processPixExpirations();
      return NextResponse.json({ payment });
    }
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    reportServerError(error, { request, route: "/api/admin/monitoring", operation: "update" });
    return NextResponse.json({ error: "Não foi possível atualizar o item." }, { status: 500 });
  }
}
