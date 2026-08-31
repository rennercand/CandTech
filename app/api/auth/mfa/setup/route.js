import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  appendAuditEvent,
  consumeMfaRecoveryCode,
  disableUserMfa,
  enableUserMfa,
  findUserByEmail,
  getUserMfa,
  markAuthSessionMfaVerified,
  savePendingUserMfa,
} from "@/lib/db";
import {
  decryptMfaSecret,
  encryptMfaSecret,
  generateMfaSecret,
  generateRecoveryCodes,
  hashMfaValue,
  mfaOtpAuthUri,
  mfaQrCodeDataUrl,
  normalizeRecoveryCode,
  verifyTotp,
} from "@/lib/mfa";
import { enforceRateLimit } from "@/lib/rate-limit";
import { guardMutation, readLimitedJson, requestBodyErrorResponse } from "@/lib/request-security";
import { reportServerError } from "@/lib/server-observability";

export const runtime = "nodejs";

async function authenticated(request) {
  const user = await getSession(request, { allowUnverified: true, allowInactiveSubscription: true });
  return user || null;
}

async function verifyCurrentPassword(user, password) {
  const stored = await findUserByEmail(user.email);
  return stored && bcrypt.compare(String(password || ""), stored.password_hash);
}

export async function GET(request) {
  const limited = await enforceRateLimit(request, { scope: "mfa-status", limit: 60 });
  if (limited) return limited;
  const user = await authenticated(request);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const mfa = await getUserMfa(user.id);
  return NextResponse.json({ enabled: Boolean(mfa?.enabled_at) }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const limited = await enforceRateLimit(request, { scope: "mfa-setup", limit: 6 });
  if (limited) return limited;
  const user = await authenticated(request);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  try {
    const { currentPassword } = await readLimitedJson(request, { maxBytes: 2_048, maxDepth: 2, maxNodes: 6, maxStringLength: 128 });
    if (!(await verifyCurrentPassword(user, currentPassword))) {
      return NextResponse.json({ error: "Senha atual inválida." }, { status: 401 });
    }
    if ((await getUserMfa(user.id))?.enabled_at) {
      return NextResponse.json({ error: "O MFA já está ativo nesta conta." }, { status: 409 });
    }
    const secret = generateMfaSecret();
    const uri = mfaOtpAuthUri({ secret, email: user.email });
    await savePendingUserMfa({
      userId: user.id, encryptedSecret: encryptMfaSecret(secret),
      expiresAt: new Date(Date.now() + 10 * 60 * 1_000),
    });
    return NextResponse.json({ secret, uri, qrCode: await mfaQrCodeDataUrl(uri), expiresInSeconds: 600 });
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    reportServerError(error, { request, route: "/api/auth/mfa/setup", operation: "start" });
    return NextResponse.json({ error: "Não foi possível iniciar a configuração do MFA." }, { status: 500 });
  }
}

export async function PATCH(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const limited = await enforceRateLimit(request, { scope: "mfa-enable", limit: 8 });
  if (limited) return limited;
  const user = await authenticated(request);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  try {
    const { code } = await readLimitedJson(request, { maxBytes: 1_024, maxDepth: 2, maxNodes: 6, maxStringLength: 20 });
    const mfa = await getUserMfa(user.id);
    if (!mfa?.pending_encrypted_secret || !mfa.pending_expires_at || new Date(mfa.pending_expires_at).getTime() <= Date.now()) {
      return NextResponse.json({ error: "A configuração expirou. Gere um novo QR Code." }, { status: 410 });
    }
    if (!verifyTotp(decryptMfaSecret(mfa.pending_encrypted_secret), code)) {
      return NextResponse.json({ error: "Código inválido. Confira o horário do celular e tente novamente." }, { status: 400 });
    }
    const recoveryCodes = generateRecoveryCodes();
    const enabled = await enableUserMfa({
      userId: user.id,
      recoveryCodeHashes: recoveryCodes.map((recoveryCode) => hashMfaValue(normalizeRecoveryCode(recoveryCode))),
    });
    if (!enabled) return NextResponse.json({ error: "A configuração expirou. Gere um novo QR Code." }, { status: 410 });
    await markAuthSessionMfaVerified({ sessionHash: user.sessionHash, userId: user.id, revokeOthers: true });
    await appendAuditEvent({
      userId: user.id, actorUserId: user.id, action: "account.mfa_enabled", origin: "api/auth/mfa/setup",
      subjectType: "user", subjectId: user.id, newState: { enabled: true, recoveryCodeCount: recoveryCodes.length },
    });
    return NextResponse.json({ enabled: true, recoveryCodes });
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    reportServerError(error, { request, route: "/api/auth/mfa/setup", operation: "enable" });
    return NextResponse.json({ error: "Não foi possível ativar o MFA." }, { status: 500 });
  }
}

export async function DELETE(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const limited = await enforceRateLimit(request, { scope: "mfa-disable", limit: 5 });
  if (limited) return limited;
  const user = await authenticated(request);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  try {
    const { currentPassword, code } = await readLimitedJson(request, { maxBytes: 2_048, maxDepth: 2, maxNodes: 8, maxStringLength: 128 });
    if (!(await verifyCurrentPassword(user, currentPassword))) {
      return NextResponse.json({ error: "Senha atual inválida." }, { status: 401 });
    }
    const mfa = await getUserMfa(user.id);
    if (!mfa?.enabled_at || !mfa.encrypted_secret) return NextResponse.json({ enabled: false });
    const normalizedRecovery = normalizeRecoveryCode(code);
    let valid = verifyTotp(decryptMfaSecret(mfa.encrypted_secret), code);
    if (!valid && normalizedRecovery.length === 16) {
      valid = await consumeMfaRecoveryCode({ userId: user.id, codeHash: hashMfaValue(normalizedRecovery) });
    }
    if (!valid) return NextResponse.json({ error: "Código de autenticação inválido." }, { status: 401 });
    await disableUserMfa({ userId: user.id, currentSessionHash: user.sessionHash });
    await appendAuditEvent({
      userId: user.id, actorUserId: user.id, action: "account.mfa_disabled", origin: "api/auth/mfa/setup",
      subjectType: "user", subjectId: user.id, previousState: { enabled: true }, newState: { enabled: false },
    });
    return NextResponse.json({ enabled: false });
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    reportServerError(error, { request, route: "/api/auth/mfa/setup", operation: "disable" });
    return NextResponse.json({ error: "Não foi possível desativar o MFA." }, { status: 500 });
  }
}
