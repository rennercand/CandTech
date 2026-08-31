import { NextResponse } from "next/server";
import { authCookie, createToken } from "@/lib/auth";
import {
  appendAuditEvent,
  consumeMfaLoginChallenge,
  consumeMfaRecoveryCode,
  failMfaLoginChallenge,
  findActiveMfaLoginChallenge,
  findUserById,
  getUserMfa,
} from "@/lib/db";
import { decryptMfaSecret, hashMfaValue, normalizeRecoveryCode, verifyTotp } from "@/lib/mfa";
import { enforceRateLimit } from "@/lib/rate-limit";
import { guardMutation, readLimitedJson, requestBodyErrorResponse } from "@/lib/request-security";
import { reportServerError } from "@/lib/server-observability";
import { PRIVACY_VERSION, TERMS_VERSION } from "@/lib/legal";

export const runtime = "nodejs";

export async function POST(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const limited = await enforceRateLimit(request, { scope: "auth-mfa-verify-ip", limit: 12 });
  if (limited) return limited;
  try {
    const { challenge, code } = await readLimitedJson(request, {
      maxBytes: 2_048, maxDepth: 2, maxNodes: 8, maxStringLength: 100,
    });
    if (!/^[A-Za-z0-9_-]{43}$/.test(String(challenge || ""))) {
      return NextResponse.json({ error: "Desafio MFA inválido ou expirado." }, { status: 401 });
    }
    const challengeHash = hashMfaValue(challenge);
    const challengeLimited = await enforceRateLimit(request, {
      scope: "auth-mfa-verify-challenge", limit: 8, identifier: challengeHash,
    });
    if (challengeLimited) return challengeLimited;
    const active = await findActiveMfaLoginChallenge(challengeHash);
    if (!active) return NextResponse.json({ error: "Desafio MFA inválido ou expirado." }, { status: 401 });
    const [mfa, user] = await Promise.all([getUserMfa(active.userId), findUserById(active.userId)]);
    if (!mfa?.enabled_at || !mfa.encrypted_secret || !user) {
      return NextResponse.json({ error: "Desafio MFA inválido ou expirado." }, { status: 401 });
    }

    const normalizedRecovery = normalizeRecoveryCode(code);
    let valid = verifyTotp(decryptMfaSecret(mfa.encrypted_secret), code);
    let recoveryUsed = false;
    if (!valid && normalizedRecovery.length === 16) {
      recoveryUsed = await consumeMfaRecoveryCode({ userId: user.id, codeHash: hashMfaValue(normalizedRecovery) });
      valid = recoveryUsed;
    }
    if (!valid) {
      await failMfaLoginChallenge(challengeHash);
      return NextResponse.json({ error: "Código inválido. Verifique o horário do autenticador ou use um código de recuperação." }, { status: 401 });
    }
    const consumedUserId = await consumeMfaLoginChallenge(challengeHash);
    if (consumedUserId !== Number(user.id)) {
      return NextResponse.json({ error: "Este desafio MFA já foi utilizado." }, { status: 401 });
    }

    const safeUser = {
      id: Number(user.id), name: user.name, email: user.email, accountType: user.account_type || "person",
      emailVerified: !user.email_verification_required || Boolean(user.email_verified_at),
      legalAccepted: Boolean(user.legal_accepted_at) && user.terms_version === TERMS_VERSION && user.privacy_version === PRIVACY_VERSION,
    };
    await appendAuditEvent({
      userId: user.id, actorUserId: user.id, action: "session.created", origin: "api/auth/mfa/verify",
      subjectType: "auth_session", newState: { active: true, mfaVerified: true, recoveryCodeUsed: recoveryUsed },
    });
    const response = NextResponse.json({ user: safeUser });
    response.cookies.set("finsight_token", await createToken(safeUser, { mfaVerified: true }), authCookie);
    return response;
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    reportServerError(error, { request, route: "/api/auth/mfa/verify", operation: "verify" });
    return NextResponse.json({ error: "Não foi possível validar o segundo fator." }, { status: 500 });
  }
}
