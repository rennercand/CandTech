import { getSession } from "@/lib/auth";
import { deleteGoogleDriveConnection, getGoogleDriveConnection } from "@/lib/db";
import {
  decryptDriveToken,
  googleDriveConfigured,
  revokeDriveToken,
} from "@/lib/google-drive";
import { enforceRateLimit } from "@/lib/rate-limit";
import { guardMutation } from "@/lib/request-security";
import { getOrganizationAccess } from "@/lib/organization-access";
import { hasPermission } from "@/lib/team-permissions";

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
      console.error("Falha ao revogar token no Google; conexão local será removida", error);
    }
    await deleteGoogleDriveConnection(user.id);
  }
  return Response.json({ connected: false });
}
