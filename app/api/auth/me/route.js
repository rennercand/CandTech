import { NextResponse } from "next/server";
import { authCookie, getSession, revokeSession } from "@/lib/auth";
import { appendAuditEvent } from "@/lib/db";
import { getOrganizationAccess, publicAccess } from "@/lib/organization-access";
import { guardMutation } from "@/lib/request-security";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getMonitoringAccessPath, isAdministrator } from "@/lib/admin-access";

export async function GET(request) {
  const limited = await enforceRateLimit(request, { scope: "session", limit: 120 });
  if (limited) return limited;
  const user = await getSession(request, { allowUnverified: true, allowInactiveSubscription: true });
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { sessionHash: _sessionHash, ...safeUser } = user;
  const access = await getOrganizationAccess(user);
  const administrator = isAdministrator(user.email);
  return NextResponse.json(
    {
      user: {
        ...safeUser,
        access: publicAccess(access),
        // O servidor toma a decisão com a lista privada de e-mails e entrega o
        // caminho apenas à sessão que acabou de ser reconhecida como administradora.
        administrator,
        monitoringPath: administrator ? getMonitoringAccessPath() : null,
      },
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function DELETE(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const limited = await enforceRateLimit(request, { scope: "session", limit: 30 });
  if (limited) return limited;
  const session = await getSession(request, { allowUnverified: true, allowInactiveSubscription: true });
  if (session) {
    await revokeSession(session);
    await appendAuditEvent({ userId: session.id, action: "session.revoked" });
  }
  const response = NextResponse.json({ ok: true });
  // A remoção precisa repetir os mesmos atributos do cookie original. Além de
  // apagá-lo corretamente, isso evita uma resposta de logout sem Secure/SameSite.
  response.cookies.set("finsight_token", "", { ...authCookie, maxAge: 0, expires: new Date(0) });
  return response;
}
