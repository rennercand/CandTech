import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { authCookie, createToken } from "@/lib/auth";
import { sendEmailVerification } from "@/lib/auth-email";
import { appendAuditEvent, createUser, isUniqueConstraintError } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { guardMutation, readLimitedJson, requestBodyErrorResponse } from "@/lib/request-security";
import { reportServerError } from "@/lib/observability";

// Força o uso do runtime Node.js, necessário para bcrypt e para o banco.
export const runtime = "nodejs";

export async function POST(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  // Cadastro compartilha o limite de autenticação entre todas as instâncias.
  const limited = await enforceRateLimit(request, { scope: "auth-register-ip", limit: 5 });
  if (limited) return limited;

  try {
    // Normaliza os campos para salvar dados consistentes e validar limites.
    const { name, email, password, accountType = "person" } = await readLimitedJson(request, {
      maxBytes: 8_192, maxDepth: 3, maxNodes: 20, maxStringLength: 254,
    });
    const rawName = String(name || "");
    const cleanName = rawName.trim();
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanPassword = String(password || "");
    if (
      cleanName.length < 2 ||
      rawName.length > 80 ||
      cleanEmail.length > 254 ||
      !/^\S+@\S+\.\S+$/.test(cleanEmail) ||
      cleanPassword.length < 8 ||
      cleanPassword.length > 128 ||
      !["person", "company"].includes(accountType)
    ) {
      return NextResponse.json(
        { error: "Informe nome, e-mail válido e senha entre 8 e 128 caracteres." },
        { status: 400 },
      );
    }

    // bcrypt adiciona um salt e transforma a senha em um hash irreversível.
    const passwordHash = await bcrypt.hash(cleanPassword, 12);
    // A camada de banco escolhe Postgres na Vercel e SQLite no ambiente local.
    const accountLimited = await enforceRateLimit(request, {
      scope: "auth-register-account", limit: 3, identifier: cleanEmail,
    });
    if (accountLimited) return accountLimited;
    const user = await createUser({ name: cleanName, email: cleanEmail, passwordHash, accountType });
    await appendAuditEvent({ userId: user.id, action: "account.created", metadata: { accountType } });

    // O cadastro continua utilizável mesmo se o provedor de e-mail estiver
    // temporariamente indisponível; o usuário poderá solicitar um novo envio.
    let emailVerificationSent = false;
    try {
      emailVerificationSent = (await sendEmailVerification({ user, request })).sent;
    } catch (emailError) {
      reportServerError(emailError, { request, route: "/api/auth/register", operation: "send-verification-email" });
    }

    // O cookie recebe um JWT assinado para autenticar as próximas requisições.
    const safeUser = {
      id: user.id, name: user.name, email: user.email,
      accountType: user.accountType || user.account_type || accountType,
      emailVerified: false,
    };
    const response = NextResponse.json({ user: safeUser, emailVerificationSent }, { status: 201 });
    response.cookies.set("finsight_token", await createToken(safeUser), authCookie);
    return response;
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    if (isUniqueConstraintError(error)) {
      return NextResponse.json({ error: "Não foi possível concluir o cadastro com os dados informados." }, { status: 400 });
    }

    // Registra o erro real apenas no servidor; a resposta pública permanece genérica.
    reportServerError(error, { request, route: "/api/auth/register", operation: "register" });
    return NextResponse.json({ error: "Não foi possível criar a conta." }, { status: 500 });
  }
}
