import { pixSettings } from "./pix.js";

const present = (value) => Boolean(String(value || "").trim());
const longSecret = (value) => String(value || "").length >= 32;
const base64Key32 = (value) => {
  try {
    return Buffer.from(String(value || ""), "base64").length === 32;
  } catch {
    return false;
  }
};

function item(id, label, status, detail, blocking = false) {
  return { id, label, status, detail, blocking };
}

export function getCommercialReadiness(env = process.env, pix = pixSettings()) {
  const senderConfigured = present(env.AUTH_EMAIL_FROM || env.TEAM_INVITE_FROM);
  const driveValues = [env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.DRIVE_TOKEN_ENCRYPTION_KEY];
  const driveCount = driveValues.filter(present).length;
  const publicUrl = String(env.PUBLIC_APP_URL || "").trim().replace(/\/$/, "");
  const checks = [
    item("database", "Banco de produção", present(env.DATABASE_URL) ? "pass" : "fail", present(env.DATABASE_URL) ? "Conexão PostgreSQL configurada." : "DATABASE_URL não está configurada.", true),
    item("session", "Sessões e autenticação", longSecret(env.JWT_SECRET) ? "pass" : "fail", longSecret(env.JWT_SECRET) ? "Segredo de sessão possui comprimento mínimo." : "JWT_SECRET precisa ter ao menos 32 caracteres.", true),
    item("mfa", "Proteção MFA", base64Key32(env.MFA_ENCRYPTION_KEY) ? "pass" : "fail", base64Key32(env.MFA_ENCRYPTION_KEY) ? "Chave AES de 32 bytes configurada." : "MFA_ENCRYPTION_KEY precisa representar 32 bytes em Base64.", true),
    item("pix", "Cobrança Pix", pix.configured ? "pass" : "fail", pix.configured ? "Chave DICT e dados do recebedor são válidos." : `Configuração inválida: ${pix.configurationIssue || "PIX_KEY_MISSING"}.`, true),
    item("receipts", "Comprovantes privados", present(env.BLOB_READ_WRITE_TOKEN) || present(env.BLOB_STORE_ID) ? "pass" : "fail", present(env.BLOB_READ_WRITE_TOKEN) || present(env.BLOB_STORE_ID) ? "Vercel Blob está conectado." : "Conecte um Blob privado antes de receber comprovantes.", true),
    item("email", "E-mails transacionais", present(env.RESEND_API_KEY) && senderConfigured ? "pass" : "fail", present(env.RESEND_API_KEY) && senderConfigured ? "Resend e remetente estão configurados." : "Configure RESEND_API_KEY e AUTH_EMAIL_FROM ou TEAM_INVITE_FROM.", true),
    item("owner", "Administrador principal", present(env.ADMIN_EMAILS) && longSecret(env.ADMIN_MONITORING_SLUG) ? "pass" : "fail", present(env.ADMIN_EMAILS) && longSecret(env.ADMIN_MONITORING_SLUG) ? "Conta proprietária e endereço privado configurados." : "Configure ADMIN_EMAILS e um ADMIN_MONITORING_SLUG com 32 caracteres.", true),
    item("cron", "Expiração de cobranças", longSecret(env.CRON_SECRET) ? "pass" : "fail", longSecret(env.CRON_SECRET) ? "Segredo do job de expiração configurado." : "CRON_SECRET precisa ter ao menos 32 caracteres.", true),
    item("billing", "Bloqueio por assinatura", String(env.VERCEL_ENV || "").toLowerCase() === "production" || String(env.BILLING_ENFORCEMENT_ENABLED || "").toLowerCase() === "true" ? "pass" : "warning", "Em Production a cobrança é obrigatória no servidor; fora dela depende da flag.", false),
    item("public-url", "Links enviados por e-mail", publicUrl === "https://www.candtech.com.br" ? "pass" : "warning", publicUrl ? "PUBLIC_APP_URL difere do domínio canônico; revise antes dos disparos." : "Defina PUBLIC_APP_URL para o domínio canônico.", false),
    item("secret-separation", "Separação dos segredos", longSecret(env.OAUTH_STATE_SECRET) && env.OAUTH_STATE_SECRET !== env.JWT_SECRET ? "pass" : "warning", longSecret(env.OAUTH_STATE_SECRET) && env.OAUTH_STATE_SECRET !== env.JWT_SECRET ? "OAuth usa segredo independente da sessão." : "Defina OAUTH_STATE_SECRET diferente de JWT_SECRET.", false),
    item("drive", "Google Drive", driveCount === 0 ? "optional" : driveCount === 3 && base64Key32(env.DRIVE_TOKEN_ENCRYPTION_KEY) ? "pass" : "warning", driveCount === 0 ? "Integração opcional ainda não configurada." : driveCount === 3 && base64Key32(env.DRIVE_TOKEN_ENCRYPTION_KEY) ? "OAuth e criptografia do Drive configurados." : "A configuração do Drive está incompleta ou a chave não possui 32 bytes.", false),
    item("support", "Canal de suporte", present(env.NEXT_PUBLIC_SUPPORT_EMAIL) ? "pass" : "warning", present(env.NEXT_PUBLIC_SUPPORT_EMAIL) ? "E-mail público de suporte configurado." : "Defina NEXT_PUBLIC_SUPPORT_EMAIL para atendimento.", false),
  ];
  const blockers = checks.filter((check) => check.blocking && check.status === "fail").length;
  const warnings = checks.filter((check) => check.status === "warning").length;
  return { ready: blockers === 0, blockers, warnings, checks, checkedAt: new Date().toISOString() };
}
