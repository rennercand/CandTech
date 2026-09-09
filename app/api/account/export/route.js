import { getSession } from "@/lib/auth";
import { getOrganizationAccess } from "@/lib/organization-access";
import { hasVerifiedMfa } from "@/lib/mfa-access";
import { enforceRateLimit } from "@/lib/rate-limit";
import { buildAccountBackup } from "@/lib/account-backup";
import { appendAuditEvent } from "@/lib/db";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const errorResponse = (error, status) => Response.json({ error }, { status, headers });

export async function GET(request) {
  const user = await getSession(request, { allowInactiveSubscription: true });
  if (!user) return errorResponse("Entre na sua conta para baixar os dados.", 401);
  const access = await getOrganizationAccess(user);
  if (!access?.isOwner) return errorResponse("Somente o proprietário pode exportar os dados da empresa.", 403);
  if (!hasVerifiedMfa(user)) return errorResponse("Entre no sistema e confirme o MFA antes de exportar.", 403);
  const limited = await enforceRateLimit(request, { scope: "account-export", limit: 3 });
  if (limited) {
    for (const [key, value] of Object.entries(headers)) limited.headers.set(key, value);
    return limited;
  }
  try {
    // Identidade sempre derivada da sessão; parâmetros do navegador não escolhem a empresa.
    const archive = await buildAccountBackup(user.id);
    // Download síncrono limitado para caber na resposta da função hospedada.
    if (archive.bytes > 4 * 1024 * 1024) return errorResponse("O ZIP excede o limite de download de 4 MiB. Contate o suporte para uma exportação assistida segura.", 413);
    await appendAuditEvent({
      userId: access.ownerUserId, actorUserId: user.id, organizationId: access.organizationId,
      action: "account.exported", origin: "api/account/export", subjectType: "account", subjectId: user.id,
      newState: { format: "zip", destination: "download", bytes: archive.bytes },
    });
    return new Response(Buffer.from(archive.content, "base64"), { headers: {
      ...headers, "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="candtech-dados.zip"',
    } });
  } catch (error) {
    if (error?.message === "BACKUP_TOO_LARGE_FOR_EMAIL") return errorResponse("Os dados excedem o limite da exportação. Contate o suporte; nenhum arquivo parcial foi entregue.", 413);
    return errorResponse("Não foi possível gerar a exportação. Tente novamente ou contate o suporte.", 500);
  }
}
