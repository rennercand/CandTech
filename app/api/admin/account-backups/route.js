import { getSession } from "@/lib/auth";
import { getAdministratorAccess } from "@/lib/admin-access";
import { hasVerifiedMfa } from "@/lib/mfa-access";
import { findUserById, findOrganizationAccess, appendAuditEvent } from "@/lib/db";
import { listAdminAccounts } from "@/lib/admin-account-list";
import { enforceRateLimit } from "@/lib/rate-limit";
import { guardMutation, readLimitedJson } from "@/lib/request-security";
import { buildAccountBackup } from "@/lib/account-backup";
import { claimIdempotency, completeIdempotency } from "@/lib/idempotency-db";
import { hashIdempotencyRequest, hashIdempotencyValue, normalizeIdempotencyKey } from "@/lib/idempotency";
import { sendAdminAccountBackup } from "@/lib/billing-email";

export const runtime = "nodejs";
const reply = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
async function authorize(request) {
  const user = await getSession(request, { allowInactiveSubscription: true });
  if (!user) return { response: reply({ error: "Não autenticado" }, 401) };
  if (!user.legalAccepted || !hasVerifiedMfa(user) || !(await getAdministratorAccess(user)).isRoot)
    return { response: reply({ error: "Somente a conta raiz com MFA pode acessar." }, 403) };
  return { user };
}
export async function GET(request) {
  const auth = await authorize(request);
  if (auth.response) return auth.response;
  const limited = await enforceRateLimit(request, { scope: "admin-backup-list", limit: 30 });
  if (limited) return limited;
  const url = new URL(request.url);
  const after = Number(url.searchParams.get("after") || 0);
  if (!Number.isSafeInteger(after) || after < 0) return reply({ error: "Página inválida" }, 400);
  const activeOnly = url.searchParams.get("active") === "1";
  const page = await listAdminAccounts({ after, activeOnly });
  if (!activeOnly) {
    const allowed = await Promise.all(page.accounts.map(async account => ({ ...account,
      administrative: (await getAdministratorAccess(await findUserById(account.id))).isStaff })));
    page.accounts = allowed.filter(account => !account.administrative && account.owner);
  }
  return reply(page);
}
export async function POST(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const auth = await authorize(request);
  if (auth.response) return auth.response;
  const limited = await enforceRateLimit(request, { scope: "admin-backup-email", limit: 3 });
  if (limited) return limited;
  let body;
  try { body = await readLimitedJson(request, { maxBytes: 1024, maxDepth: 2, maxNodes: 10 }); }
  catch { return reply({ error: "Solicitação inválida" }, 400); }
  const key = normalizeIdempotencyKey(request.headers.get("idempotency-key"));
  if (!key || !Number.isSafeInteger(body.userId) || body.userId < 1 || body.confirm !== true || Object.keys(body).some(k => !["userId", "confirm"].includes(k)))
    return reply({ error: "Confirme a conta e informe uma chave de operação válida. Destinatário livre não é permitido." }, 400);
  const target = await findUserById(body.userId);
  if (!target || !target.email_verified_at) return reply({ error: "Conta indisponível ou e-mail ainda não verificado." }, 409);
  const organization = await findOrganizationAccess(target.id);
  if ((await getAdministratorAccess(target)).isStaff || (organization && organization.role !== "owner"))
    return reply({ error: "Selecione o titular cliente, não colaborador ou conta administrativa." }, 403);
  const context = { userId: auth.user.id, operation: "admin.account-backup.email", keyHash: hashIdempotencyValue(key), requestHash: hashIdempotencyRequest({ userId: target.id }) };
  const claim = await claimIdempotency({ ...context, allowReclaim: false });
  if (claim.state === "replay") return reply(claim.body, claim.status);
  if (claim.state !== "claimed") return reply({ error: "Operação já iniciada ou chave em conflito. Consulte o suporte antes de repetir." }, 409);
  try {
    const archive = await buildAccountBackup(target.id);
    await appendAuditEvent({ userId: target.id, actorUserId: auth.user.id, organizationId: organization?.organizationId,
      action: "account.backup_email_requested", origin: "api/admin/account-backups", subjectType: "account", subjectId: target.id,
      newState: { bytes: archive.bytes, destination: "verified-owner-email" } });
    const sent = await sendAdminAccountBackup({ recipient: target.email, attachment: archive.content, operationKey: context.keyHash });
    const result = sent ? { accepted: true, message: "Envio aceito pelo provedor. Isso não confirma a chegada à caixa de entrada." } : { error: "Serviço de e-mail não configurado." };
    await completeIdempotency({ ...context, body: result, status: sent ? 202 : 503 });
    return reply(result, sent ? 202 : 503);
  } catch {
    // Resultado externo pode ser incerto: encerra a operação sem reenvio automático.
    const result = { error: "Envio não confirmado. Verifique o provedor antes de iniciar outro envio; nenhum reenvio automático será feito." };
    await completeIdempotency({ ...context, body: result, status: 502 });
    return reply(result, 502);
  }
}
