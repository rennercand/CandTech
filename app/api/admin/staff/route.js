import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getAdministratorAccess } from "@/lib/admin-access";
import { appendAuditEvent } from "@/lib/db";
import { listStaffAccess, revokeStaffAccess, saveStaffAccessByEmail } from "@/lib/staff-db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { guardMutation, readLimitedJson, requestBodyErrorResponse } from "@/lib/request-security";
import { reportServerError } from "@/lib/server-observability";

export const runtime = "nodejs";

async function authorizeRoot(request) {
  const user = await getSession(request, { allowInactiveSubscription: true });
  if (!user) return { response: NextResponse.json({ error: "Não autenticado" }, { status: 401 }) };
  if (!user.legalAccepted) return { response: NextResponse.json({ error: "Aceite jurídico pendente." }, { status: 403 }) };
  const access = await getAdministratorAccess(user);
  if (!access.canManageStaff) return { response: NextResponse.json({ error: "Somente o administrador principal gerencia a equipe interna." }, { status: 403 }) };
  return { user };
}

export async function GET(request) {
  const limited = await enforceRateLimit(request, { scope: "admin-staff-list", limit: 30 });
  if (limited) return limited;
  const auth = await authorizeRoot(request);
  if (auth.response) return auth.response;
  return NextResponse.json({ staff: await listStaffAccess() }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PUT(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const limited = await enforceRateLimit(request, { scope: "admin-staff-update", limit: 20 });
  if (limited) return limited;
  const auth = await authorizeRoot(request);
  if (auth.response) return auth.response;
  try {
    const body = await readLimitedJson(request, { maxBytes: 4_096, maxDepth: 3, maxNodes: 20, maxStringLength: 254 });
    const email = String(body.email || "").trim().toLowerCase();
    if (email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) {
      return NextResponse.json({ error: "Informe o e-mail de uma conta existente." }, { status: 400 });
    }
    const permissions = {
      canMonitor: body.canMonitor === true,
      canSupport: body.canSupport === true,
      canBilling: body.canBilling === true,
    };
    if (!permissions.canMonitor && !permissions.canSupport && !permissions.canBilling) {
      return NextResponse.json({ error: "Selecione ao menos uma permissão ou use Revogar." }, { status: 400 });
    }
    const staff = await saveStaffAccessByEmail({ email, ...permissions, grantedBy: auth.user.id });
    if (!staff) return NextResponse.json({ error: "A pessoa precisa criar e verificar uma conta CandTech com esse e-mail primeiro." }, { status: 404 });
    await appendAuditEvent({
      userId: staff.userId,
      action: "staff.access_updated",
      metadata: { administratorId: auth.user.id, permissions },
    }).catch((error) => reportServerError(error, { request, route: "/api/admin/staff", operation: "audit-staff-update" }));
    return NextResponse.json({ staff });
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    reportServerError(error, { request, route: "/api/admin/staff", operation: "update-staff" });
    return NextResponse.json({ error: "Não foi possível atualizar o acesso interno." }, { status: 500 });
  }
}

export async function DELETE(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const limited = await enforceRateLimit(request, { scope: "admin-staff-revoke", limit: 20 });
  if (limited) return limited;
  const auth = await authorizeRoot(request);
  if (auth.response) return auth.response;
  try {
    const body = await readLimitedJson(request, { maxBytes: 2_048, maxDepth: 2, maxNodes: 10, maxStringLength: 80 });
    const userId = Number(body.userId);
    if (!Number.isSafeInteger(userId) || userId < 1) return NextResponse.json({ error: "Conta interna inválida." }, { status: 400 });
    const removed = await revokeStaffAccess(userId);
    if (!removed) return NextResponse.json({ error: "Acesso interno não encontrado." }, { status: 404 });
    await appendAuditEvent({ userId, action: "staff.access_revoked", metadata: { administratorId: auth.user.id } })
      .catch((error) => reportServerError(error, { request, route: "/api/admin/staff", operation: "audit-staff-revoke" }));
    return NextResponse.json({ ok: true });
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    reportServerError(error, { request, route: "/api/admin/staff", operation: "revoke-staff" });
    return NextResponse.json({ error: "Não foi possível revogar o acesso interno." }, { status: 500 });
  }
}
