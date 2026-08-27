import { getSession } from "@/lib/auth";
import { getGoogleDriveConnection } from "@/lib/db";
import {
  decryptDriveToken,
  refreshDriveAccessToken,
  uploadFileToDrive,
} from "@/lib/google-drive";
import { historyXlsx, historyXlsxFilename } from "@/lib/history-xlsx";
import { enforceRateLimit } from "@/lib/rate-limit";
import { guardMutation, readLimitedJson, requestBodyErrorResponse } from "@/lib/request-security";
import { getAccessibleHistory } from "@/lib/organization-access";
import { reportServerError } from "@/lib/server-observability";
import { safeExportFilename } from "@/lib/export-filename";

export const runtime = "nodejs";

export async function POST(request, { params }) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const limited = await enforceRateLimit(request, { scope: "drive-upload", limit: 20 });
  if (limited) return limited;
  const user = await getSession(request);
  if (!user) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const { id } = await params;
  const { item, forbidden } = await getAccessibleHistory({ user, id, permissions: ["history", "exports", "drive"] });
  if (forbidden) return Response.json({ error: "Sem permissão para enviar arquivos ao Drive." }, { status: 403 });
  if (!item) return Response.json({ error: "Registro não encontrado" }, { status: 404 });
  const connection = await getGoogleDriveConnection(user.id);
  if (!connection) {
    return Response.json({ error: "Conecte sua conta do Google Drive primeiro." }, { status: 409 });
  }

  try {
    const body = await readLimitedJson(request, { maxBytes: 1_024, maxDepth: 2, maxNodes: 8, maxStringLength: 120 });
    const refreshToken = decryptDriveToken(connection.encrypted_refresh_token);
    const accessToken = await refreshDriveAccessToken(refreshToken);
    const file = await uploadFileToDrive({
      accessToken,
      filename: safeExportFilename(body.filename, "xlsx", historyXlsxFilename(item)),
      content: historyXlsx(item),
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    return Response.json({ file });
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    const reconnect = error?.code === "invalid_grant";
    reportServerError(error, { request, route: "/api/history/:id/drive", operation: "upload", status: reconnect ? 401 : 502 });
    return Response.json(
      {
        error: reconnect
          ? "A autorização do Google expirou. Conecte o Drive novamente."
          : "Não foi possível enviar o arquivo ao Google Drive.",
        reconnect,
      },
      { status: reconnect ? 401 : 502 },
    );
  }
}
