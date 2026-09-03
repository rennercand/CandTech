import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getAdministratorAccess } from "@/lib/admin-access";
import { appendAuditEvent, listAuditEventsForRoot } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { hasVerifiedMfa, mfaRequiredResponse } from "@/lib/mfa-access";
import { reportServerError } from "@/lib/server-observability";

export const runtime = "nodejs";

export async function GET(request) {
  const limited = await enforceRateLimit(request, { scope: "admin-audit-list", limit: 30 });
  if (limited) return limited;
  const user = await getSession(request, { allowInactiveSubscription: true });
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!user.legalAccepted) return NextResponse.json({ error: "Aceite jurídico pendente." }, { status: 403 });
  const access = await getAdministratorAccess(user);
  if (!access.isRoot) return NextResponse.json({ error: "Acesso restrito à conta raiz." }, { status: 403 });
  if (!hasVerifiedMfa(user)) return mfaRequiredResponse();

  try {
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor");
    if (cursor && !/^\d+$/.test(cursor)) return NextResponse.json({ error: "Cursor inválido." }, { status: 400 });
    const page = await listAuditEventsForRoot({ cursor, limit: 50 });
    await appendAuditEvent({
      userId: user.id,
      actorUserId: user.id,
      action: "audit.events_viewed",
      origin: "api/admin/audit",
      subjectType: "audit_log",
      metadata: { pageSize: page.items.length, cursorUsed: Boolean(cursor) },
    }).catch(() => null);
    return NextResponse.json({
      ...page,
      policy: {
        access: "root_with_mfa",
        retention: "legal_hold",
        automaticDeletion: false,
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    reportServerError(error, { request, route: "/api/admin/audit", operation: "list" });
    return NextResponse.json({ error: "Não foi possível consultar a auditoria." }, { status: 500 });
  }
}
