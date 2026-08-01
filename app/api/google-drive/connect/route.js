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
    const redirectUri = `${new URL(request.url).origin}/api/google-drive/callback`;
    const authorizationUrl = await googleAuthorizationUrl({ userId: user.id, redirectUri });
    return Response.redirect(authorizationUrl, 302);
  } catch (error) {
    console.error("Falha ao iniciar OAuth do Google Drive", error);
    return Response.json({ error: "Não foi possível conectar ao Google Drive." }, { status: 500 });
  }
}
