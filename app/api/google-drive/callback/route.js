import { getSession } from "@/lib/auth";
import { saveGoogleDriveConnection } from "@/lib/db";
import {
  encryptDriveToken,
  exchangeAuthorizationCode,
  verifyDriveState,
} from "@/lib/google-drive";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

function finish(request, status, historyId = null) {
  const url = new URL("/", request.url);
  url.searchParams.set("drive", status);
  // A página retoma a exportação; a API ainda verifica se o histórico pertence ao usuário.
  if (historyId) url.searchParams.set("export", String(historyId));
  return Response.redirect(url, 302);
}

export async function GET(request) {
  const limited = await enforceRateLimit(request, { scope: "drive-callback", limit: 20 });
  if (limited) return limited;
  const user = await getSession(request);
  if (!user) return finish(request, "session-error");

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (url.searchParams.get("error") || !code || !state) return finish(request, "denied");

  try {
    const verified = await verifyDriveState(state);
    const callbackUri = `${url.origin}${url.pathname}`;
    if (verified.userId !== user.id || verified.redirectUri !== callbackUri) {
      return finish(request, "state-error");
    }
    const refreshToken = await exchangeAuthorizationCode({
      code,
      redirectUri: verified.redirectUri,
    });
    // Somente a versão cifrada do token persistente entra no banco de dados.
    await saveGoogleDriveConnection(user.id, encryptDriveToken(refreshToken));
    return finish(request, "connected", verified.historyId);
  } catch (error) {
    console.error("Falha no callback do Google Drive", error);
    return finish(request, "error");
  }
}
