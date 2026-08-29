import { getSession } from "@/lib/auth";
import { appendAuditEvent, deleteGoogleDriveConnection, getGoogleDriveConnection } from "@/lib/db";
import {
  decryptDriveToken,
  googleDriveConfigured,
  revokeDriveToken,
} from "@/lib/google-drive";
import { enforceRateLimit } from "@/lib/rate-limit";
import { guardMutation } from "@/lib/request-security";
import { getOrganizationAccess } from "@/lib/organization-access";
import { hasPermission } from "@/lib/team-permissions";
import { reportServerError } from "@/lib/server-observability";

async function canUseDrive(user) {
  return hasPermission(await getOrganizationAccess(user), "drive");
}

export const runtime = "nodejs";

export async function GET(request) {
  const limited = await enforceRateLimit(request, { scope: "drive-status", limit: 120 });
  if (limited) return limited;
  const user = await getSession(request);
  if (!user) return Response.json({ error: "Não autenticado" }, { status: 401 });
  if (!(await canUseDrive(user))) return Response.json({ error: "Sem permissão para usar o Drive." }, { status: 403 });
  const configured = googleDriveConfigured();
  const connection = configured ? await getGoogleDriveConnection(user.id) : null;
  return Response.json(
    { configured, connected: Boolean(connection) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function DELETE(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const limited = await enforceRateLimit(request, { scope: "drive-disconnect", limit: 20 });
  if (limited) return limited;
  const user = await getSession(request);
  if (!user) return Response.json({ error: "Não autenticado" }, { status: 401 });
  if (!(await canUseDrive(user))) return Response.json({ error: "Sem permissão para usar o Drive." }, { status: 403 });

  const connection = await getGoogleDriveConnection(user.id);
  if (connection) {
    try {
      await revokeDriveToken(decryptDriveToken(connection.encrypted_refresh_token));
    } catch (error) {
      reportServerError(error, { request, route: "/api/google-drive/status", operation: "revoke", status: 502 });
    }
    await deleteGoogleDriveConnection(user.id);
    const access = await getOrganizationAccess(user);
    await appendAuditEvent({
      userId: user.id, actorUserId: user.id, organizationId: access?.organizationId || null,
      action: "google_drive.disconnected", origin: "api/google-drive/status",
      subjectType: "google_drive_connection", subjectId: user.id,
      previousState: { connected: true }, newState: { connected: false },
    });
  }
  return Response.json({ connected: false });
}
