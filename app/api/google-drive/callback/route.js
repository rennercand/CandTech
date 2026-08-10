import { saveGoogleDriveConnection } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  encryptDriveToken,
  exchangeAuthorizationCode,
  verifyDriveState,
} from "@/lib/google-drive";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/organization-access";

export const runtime = "nodejs";

function finish(request, status, { historyId = null, returnTo = "" } = {}) {
  const url = new URL("/", request.url);
  url.searchParams.set("drive", status);
  // A página retoma a exportação; a API ainda verifica se o histórico pertence ao usuário.
  if (historyId) url.searchParams.set("export", String(historyId));
  if (returnTo === "inventory") url.searchParams.set("inventoryDrive", "1");
  return Response.redirect(url, 302);
}

export async function GET(request) {
  const limited = await enforceRateLimit(request, { scope: "drive-callback", limit: 20 });
  if (limited) return limited;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (url.searchParams.get("error") || !code || !state) return finish(request, "denied");

  try {
    const verified = await verifyDriveState(state);
    const session = await getSession(request);
    const callbackUri = `${url.origin}${url.pathname}`;
    // O state assinado expira em 10 minutos; o callback também exige a mesma
    // sessão iniciadora, evitando associar o Drive à conta errada.
    if (
      verified.redirectUri !== callbackUri || !session ||
      session.id !== verified.userId || session.sessionHash !== verified.sessionHash ||
      !(await requirePermission(session, "drive"))
    ) {
      return finish(request, "state-error");
    }
    const refreshToken = await exchangeAuthorizationCode({
      code,
      redirectUri: verified.redirectUri,
    });
    // Somente a versão cifrada do token persistente entra no banco de dados.
    await saveGoogleDriveConnection(verified.userId, encryptDriveToken(refreshToken));
    return finish(request, "connected", { historyId: verified.historyId, returnTo: verified.returnTo });
  } catch (error) {
    console.error("Falha no callback do Google Drive", error);
    return finish(request, "error");
  }
}
