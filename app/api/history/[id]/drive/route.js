import { getSession } from "@/lib/auth";
import { findHistoryById, getGoogleDriveConnection, serializeHistory } from "@/lib/db";
import {
  decryptDriveToken,
  refreshDriveAccessToken,
  uploadFileToDrive,
} from "@/lib/google-drive";
import { historyXlsx, historyXlsxFilename } from "@/lib/history-xlsx";
import { enforceRateLimit } from "@/lib/rate-limit";
import { guardMutation } from "@/lib/request-security";

export const runtime = "nodejs";

export async function POST(request, { params }) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const limited = await enforceRateLimit(request, { scope: "drive-upload", limit: 20 });
  if (limited) return limited;
  const user = await getSession(request);
  if (!user) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const { id } = await params;
  const row = await findHistoryById(Number(id), user.id);
  if (!row) return Response.json({ error: "Registro não encontrado" }, { status: 404 });
  const connection = await getGoogleDriveConnection(user.id);
  if (!connection) {
    return Response.json({ error: "Conecte sua conta do Google Drive primeiro." }, { status: 409 });
  }

  try {
    const item = serializeHistory(row);
    const refreshToken = decryptDriveToken(connection.encrypted_refresh_token);
    const accessToken = await refreshDriveAccessToken(refreshToken);
    const file = await uploadFileToDrive({
      accessToken,
      filename: historyXlsxFilename(item),
      content: historyXlsx(item),
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    return Response.json({ file });
  } catch (error) {
    console.error("Falha ao enviar histórico ao Google Drive", error);
    const reconnect = error?.code === "invalid_grant";
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
