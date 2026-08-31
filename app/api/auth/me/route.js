import { NextResponse } from "next/server";
import { authCookie, getSession, revokeSession } from "@/lib/auth";
import { appendAuditEvent } from "@/lib/db";
import { getOrganizationAccess, publicAccess } from "@/lib/organization-access";
import { guardMutation } from "@/lib/request-security";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getAdministratorAccess, getMonitoringAccessPath } from "@/lib/admin-access";

export async function GET(request) {
  const limited = await enforceRateLimit(request, { scope: "session", limit: 120 });
  if (limited) return limited;
  const user = await getSession(request, { allowUnverified: true, allowInactiveSubscription: true });
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { sessionHash: _sessionHash, ...safeUser } = user;
  const access = await getOrganizationAccess(user);
  const adminAccess = await getAdministratorAccess(user);
  const administrator = adminAccess.isStaff;
  const mfaRequired = access?.role === "owner" || administrator;
  return NextResponse.json(
    {
      user: {
        ...safeUser,
        access: publicAccess(access),
        // O servidor combina a raiz privada com as permissões atuais do banco e
        // entrega o caminho apenas à sessão reconhecida como equipe interna.
        administrator,
        administrativePermissions: administrator ? adminAccess : null,
        monitoringPath: administrator ? getMonitoringAccessPath() : null,
        mfaRequired,
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
    await appendAuditEvent({
      userId: session.id, actorUserId: session.id, action: "session.revoked", origin: "api/auth/me",
      subjectType: "auth_session", previousState: { active: true }, newState: { active: false },
    });
  }
  const response = NextResponse.json({ ok: true });
  // A remoção precisa repetir os mesmos atributos do cookie original. Além de
  // apagá-lo corretamente, isso evita uma resposta de logout sem Secure/SameSite.
  response.cookies.set("finsight_token", "", { ...authCookie, maxAge: 0, expires: new Date(0) });
  return response;
}
