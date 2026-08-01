import { getSession } from "@/lib/auth";
import { googleAuthorizationUrl, googleDriveConfigured } from "@/lib/google-drive";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET(request) {
  const limited = await enforceRateLimit(request, { scope: "drive-connect", limit: 20 });
  if (limited) return limited;
  const user = await getSession(request);
  if (!user) return Response.json({ error: "Não autenticado" }, { status: 401 });
  if (!googleDriveConfigured()) {
    return Response.json({ error: "Google Drive não configurado" }, { status: 503 });
  }

  try {
    const requestUrl = new URL(request.url);
    const historyId = Number(requestUrl.searchParams.get("historyId"));
    if (!Number.isInteger(historyId) || historyId <= 0) {
      return Response.json({ error: "Histórico inválido para exportação." }, { status: 400 });
    }

    const redirectUri = `${requestUrl.origin}/api/google-drive/callback`;
    // O histórico segue dentro do state assinado e será validado novamente no upload.
    const authorizationUrl = await googleAuthorizationUrl({
      userId: user.id,
      redirectUri,
      historyId,
    });
    return Response.redirect(authorizationUrl, 302);
  } catch (error) {
    console.error("Falha ao iniciar OAuth do Google Drive", error);
    return Response.json({ error: "Não foi possível conectar ao Google Drive." }, { status: 500 });
  }
}
