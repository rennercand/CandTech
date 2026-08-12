import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isAdministrator } from "@/lib/admin-access";
import { listMonitoringEvents, listSupportTicketsForAdmin, replySupportTicket, updateMonitoringEventStatus } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { guardMutation, readLimitedJson, requestBodyErrorResponse } from "@/lib/request-security";
import { reportServerError } from "@/lib/server-observability";

export const runtime = "nodejs";

async function authorize(request) {
  const user = await getSession(request, { allowInactiveSubscription: true });
  if (!user) return { response: NextResponse.json({ error: "Não autenticado" }, { status: 401 }) };
  if (!isAdministrator(user.email)) return { response: NextResponse.json({ error: "Acesso restrito" }, { status: 403 }) };
  return { user };
}

export async function GET(request) {
  const limited = await enforceRateLimit(request, { scope: "admin-monitoring", limit: 60 });
  if (limited) return limited;
  const auth = await authorize(request);
  if (auth.response) return auth.response;
  try {
    const [events, tickets] = await Promise.all([listMonitoringEvents(), listSupportTicketsForAdmin()]);
    return NextResponse.json({
      events,
      tickets,
      totals: {
        openEvents: events.filter((item) => item.status !== "resolved").length,
        criticalEvents: events.filter((item) => item.level === "error" && item.status !== "resolved").length,
        openTickets: tickets.filter((item) => item.status === "open").length,
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
      const event = await updateMonitoringEventStatus({ id: String(body.id || ""), status: body.status });
      if (!event) return NextResponse.json({ error: "Incidente não encontrado." }, { status: 404 });
      return NextResponse.json({ event });
    }
    if (body.type === "ticket") {
      const reply = String(body.reply || "").trim().slice(0, 4_000);
      if (reply.length < 2) return NextResponse.json({ error: "Escreva uma resposta." }, { status: 400 });
      const ticket = await replySupportTicket({ id: String(body.id || ""), reply, status: body.status });
      if (!ticket) return NextResponse.json({ error: "Mensagem não encontrada." }, { status: 404 });
      return NextResponse.json({ ticket });
    }
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    reportServerError(error, { request, route: "/api/admin/monitoring", operation: "update" });
    return NextResponse.json({ error: "Não foi possível atualizar o item." }, { status: 500 });
  }
}
