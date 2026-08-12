import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { authCookie, createToken } from "@/lib/auth";
import { sendEmailVerification } from "@/lib/auth-email";
import { appendAuditEvent, createUser, findUserByEmail, isUniqueConstraintError } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { guardMutation, readLimitedJson, requestBodyErrorResponse } from "@/lib/request-security";
import { reportServerError } from "@/lib/server-observability";
import { PRIVACY_VERSION, TERMS_VERSION } from "@/lib/legal";

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
    const { name, email, password, accountType = "person", legalAccepted = false } = await readLimitedJson(request, {
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
    if (legalAccepted !== true) {
      return NextResponse.json({ error: "Aceite os Termos de Uso e o Aviso de Privacidade para criar a conta." }, { status: 400 });
    }

    // A consulta melhora a mensagem na tentativa comum; o índice único do banco
    // continua sendo a proteção definitiva contra duas requisições simultâneas.
    if (await findUserByEmail(cleanEmail)) {
      return NextResponse.json(
        { error: "Já existe uma conta criada com este e-mail. Entre na sua conta ou recupere a senha.", code: "EMAIL_ALREADY_REGISTERED" },
        { status: 409 },
      );
    }

    // bcrypt adiciona um salt e transforma a senha em um hash irreversível.
    const passwordHash = await bcrypt.hash(cleanPassword, 12);
    // A camada de banco escolhe Postgres na Vercel e SQLite no ambiente local.
    const accountLimited = await enforceRateLimit(request, {
      scope: "auth-register-account", limit: 3, identifier: cleanEmail,
    });
    if (accountLimited) return accountLimited;
    const acceptedAt = new Date().toISOString();
    const user = await createUser({
      name: cleanName, email: cleanEmail, passwordHash, accountType,
      legalAcceptance: { acceptedAt, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION },
    });
    await appendAuditEvent({ userId: user.id, action: "account.created", metadata: { accountType, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION } });

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
      legalAccepted: true,
    };
    const response = NextResponse.json({ user: safeUser, emailVerificationSent }, { status: 201 });
    response.cookies.set("finsight_token", await createToken(safeUser), authCookie);
    return response;
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    if (isUniqueConstraintError(error)) {
      return NextResponse.json(
        { error: "Já existe uma conta criada com este e-mail. Entre na sua conta ou recupere a senha.", code: "EMAIL_ALREADY_REGISTERED" },
        { status: 409 },
      );
    }

    // Registra o erro real apenas no servidor; a resposta pública permanece genérica.
    reportServerError(error, { request, route: "/api/auth/register", operation: "register" });
    return NextResponse.json({ error: "Não foi possível criar a conta." }, { status: 500 });
  }
}
