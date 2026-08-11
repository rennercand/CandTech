import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { authCookie, createToken } from "@/lib/auth";
import { appendAuditEvent, findUserByEmail } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { guardMutation, readLimitedJson, requestBodyErrorResponse } from "@/lib/request-security";
import { reportServerError } from "@/lib/observability";

// Mantém a rota no runtime Node.js, compatível com bcrypt e o banco.
export const runtime = "nodejs";

// Hash válido usado quando a conta não existe, reduzindo diferença de tempo
// entre e-mails cadastrados e não cadastrados sem expor nenhuma senha real.
const DUMMY_PASSWORD_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEe.ouq7cQOk0i3dP8QqLGF0fDwvxTW3P6m";

export async function POST(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  // Login possui limite mais restrito para reduzir tentativas automatizadas de senha.
  const limited = await enforceRateLimit(request, { scope: "auth-login-ip", limit: 10 });
  if (limited) return limited;

  try {
    const { email, password } = await readLimitedJson(request, {
      maxBytes: 8_192, maxDepth: 3, maxNodes: 12, maxStringLength: 254,
    });
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanPassword = String(password || "");
    if (cleanEmail.length > 254 || cleanPassword.length > 128) {
      return NextResponse.json({ error: "E-mail ou senha inválidos." }, { status: 401 });
    }
    // Procura pelo e-mail normalizado; a senha armazenada nunca vai para o cliente.
    const accountLimited = await enforceRateLimit(request, {
      scope: "auth-login-account", limit: 10, identifier: cleanEmail,
    });
    if (accountLimited) return accountLimited;
    const user = await findUserByEmail(cleanEmail);
    const passwordMatches = await bcrypt.compare(cleanPassword, user?.password_hash || DUMMY_PASSWORD_HASH);
    if (!user || !passwordMatches) {
      return NextResponse.json({ error: "E-mail ou senha inválidos." }, { status: 401 });
    }

    // safeUser remove o hash antes de criar a resposta e o token.
    const safeUser = {
      id: user.id, name: user.name, email: user.email, accountType: user.account_type || "person",
      emailVerified: !user.email_verification_required || Boolean(user.email_verified_at),
    };
    await appendAuditEvent({ userId: user.id, action: "session.created" });
    const response = NextResponse.json({ user: safeUser });
    response.cookies.set("finsight_token", await createToken(safeUser), authCookie);
    return response;
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    // Mantém detalhes técnicos nos logs da Vercel, sem vazar informações ao usuário.
    reportServerError(error, { request, route: "/api/auth/login", operation: "login" });
    return NextResponse.json({ error: "Não foi possível entrar." }, { status: 500 });
  }
}
