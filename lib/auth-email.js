import { createHash, randomBytes } from "node:crypto";
import { createAuthActionToken } from "@/lib/db";

const VERIFY_TTL_MS = 24 * 60 * 60 * 1_000;
const RESET_TTL_MS = 30 * 60 * 1_000;

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

export function hashAuthActionToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

function publicBaseUrl(request) {
  const configured = String(process.env.PUBLIC_APP_URL || "").trim();
  if (configured) return configured.replace(/\/$/, "");
  if (process.env.NODE_ENV === "production") return "https://candtech.com.br";
  return new URL(request.url).origin;
}

function sender() {
  return String(process.env.AUTH_EMAIL_FROM || process.env.TEAM_INVITE_FROM || "").trim();
}

async function sendEmail({ to, subject, html, idempotencyKey }) {
  if (!process.env.RESEND_API_KEY || !sender()) return { sent: false, reason: "not_configured" };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ from: sender(), to: [to], subject, html }),
  });
  if (!response.ok) throw new Error(`Resend recusou o e-mail de autenticação (${response.status}).`);
  return { sent: true };
}

async function issueToken({ userId, purpose, ttlMs }) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashAuthActionToken(token);
  await createAuthActionToken({ userId, purpose, tokenHash, expiresAt: new Date(Date.now() + ttlMs) });
  return { token, tokenHash };
}

export async function sendEmailVerification({ user, request }) {
  const { token, tokenHash } = await issueToken({ userId: user.id, purpose: "verify_email", ttlMs: VERIFY_TTL_MS });
  const url = `${publicBaseUrl(request)}/verificar-email#token=${encodeURIComponent(token)}`;
  const name = escapeHtml(user.name || "");
  return sendEmail({
    to: user.email,
    subject: "Confirme seu e-mail na CandTech",
    idempotencyKey: `verify-email/${tokenHash}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#171717"><h1 style="font-size:24px">Confirme seu e-mail</h1><p>Olá, ${name}. Confirme que este endereço pertence a você.</p><p><a href="${url}" style="display:inline-block;padding:12px 18px;background:#3157df;color:#fff;text-decoration:none;border-radius:8px">Confirmar meu e-mail</a></p><p style="color:#666;font-size:13px">O link expira em 24 horas e funciona uma única vez. Se você não criou a conta, ignore esta mensagem.</p></div>`,
  });
}

export async function sendPasswordReset({ user, request }) {
  const { token, tokenHash } = await issueToken({ userId: user.id, purpose: "reset_password", ttlMs: RESET_TTL_MS });
  const url = `${publicBaseUrl(request)}/redefinir-senha#token=${encodeURIComponent(token)}`;
  return sendEmail({
    to: user.email,
    subject: "Redefina sua senha da CandTech",
    idempotencyKey: `reset-password/${tokenHash}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#171717"><h1 style="font-size:24px">Redefinição de senha</h1><p>Recebemos uma solicitação para trocar a senha da sua conta.</p><p><a href="${url}" style="display:inline-block;padding:12px 18px;background:#3157df;color:#fff;text-decoration:none;border-radius:8px">Criar uma nova senha</a></p><p style="color:#666;font-size:13px">O link expira em 30 minutos e funciona uma única vez. Se não foi você, ignore esta mensagem e sua senha continuará igual.</p></div>`,
  });
}
