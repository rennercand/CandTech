import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createSupportTicket, listSupportTicketsForUser } from "@/lib/db";
import { getOrganizationAccess } from "@/lib/organization-access";
import { publicSupportContact } from "@/lib/support-contact";
import { enforceRateLimit } from "@/lib/rate-limit";
import { guardMutation, readLimitedJson, requestBodyErrorResponse } from "@/lib/request-security";
import { reportServerError } from "@/lib/server-observability";

export const runtime = "nodejs";

async function authenticated(request) {
  return getSession(request, { allowUnverified: false, allowInactiveSubscription: true });
}

export async function GET(request) {
  const limited = await enforceRateLimit(request, { scope: "support-list", limit: 60 });
  if (limited) return limited;
  const user = await authenticated(request);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  try {
    return NextResponse.json({ tickets: await listSupportTicketsForUser(user.id), contact: publicSupportContact() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    reportServerError(error, { request, route: "/api/support", operation: "list" });
    return NextResponse.json({ error: "Não foi possível carregar o suporte." }, { status: 500 });
  }
}

export async function POST(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const limited = await enforceRateLimit(request, { scope: "support-create", limit: 6 });
  if (limited) return limited;
  const user = await authenticated(request);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  try {
    const body = await readLimitedJson(request, { maxBytes: 8_192, maxStringLength: 4_000 });
    const subject = String(body.subject || "").trim().slice(0, 120);
    const message = String(body.message || "").trim().slice(0, 4_000);
    const preferredChannel = ["site", "email", "phone"].includes(body.preferredChannel) ? body.preferredChannel : "site";
    if (subject.length < 4 || message.length < 10) return NextResponse.json({ error: "Informe um assunto e descreva o que aconteceu." }, { status: 400 });
    const access = await getOrganizationAccess(user);
    const ticket = await createSupportTicket({ userId: user.id, organizationId: access?.organizationId || null, subject, message, preferredChannel });
    return NextResponse.json({ ticket }, { status: 201 });
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    reportServerError(error, { request, route: "/api/support", operation: "create" });
    return NextResponse.json({ error: "Não foi possível enviar a mensagem." }, { status: 500 });
  }
}
