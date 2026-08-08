import { NextResponse } from "next/server";
import { getSession, revokeSession } from "@/lib/auth";
import { appendAuditEvent } from "@/lib/db";
import { getOrganizationAccess, publicAccess } from "@/lib/organization-access";
import { guardMutation } from "@/lib/request-security";
import { enforceRateLimit } from "@/lib/rate-limit";

export async function GET(request) {
  const limited = await enforceRateLimit(request, { scope: "session", limit: 120 });
  if (limited) return limited;
  const user = await getSession(request);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { sessionHash: _sessionHash, ...safeUser } = user;
  const access = await getOrganizationAccess(user);
  return NextResponse.json(
    { user: { ...safeUser, access: publicAccess(access) } },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function DELETE(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const limited = await enforceRateLimit(request, { scope: "session", limit: 30 });
  if (limited) return limited;
  const session = await getSession(request);
  if (session) {
    await revokeSession(session);
    await appendAuditEvent({ userId: session.id, action: "session.revoked" });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set("finsight_token", "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
