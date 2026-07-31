import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { authCookie, createToken } from "@/lib/auth";
import { createUser, isUniqueConstraintError } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { guardMutation } from "@/lib/request-security";

// Força o uso do runtime Node.js, necessário para bcrypt e para o banco.
export const runtime = "nodejs";

export async function POST(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  // Cadastro compartilha o limite de autenticação entre todas as instâncias.
  const limited = await enforceRateLimit(request, { scope: "auth", limit: 10 });
  if (limited) return limited;

  try {
    // Normaliza os campos para salvar dados consistentes e validar limites.
    const { name, email, password } = await request.json();
    const rawName = String(name || "");
    const cleanName = rawName.trim();
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanPassword = String(password || "");
    if (
      cleanName.length < 2 ||
      rawName.length > 80 ||
      cleanEmail.length > 254 ||
      !/^\S+@\S+\.\S+$/.test(cleanEmail) ||
      cleanPassword.length < 12 ||
      cleanPassword.length > 128
    ) {
      return NextResponse.json(
        { error: "Informe nome, e-mail válido e senha entre 12 e 128 caracteres." },
        { status: 400 },
      );
    }

    // bcrypt adiciona um salt e transforma a senha em um hash irreversível.
    const passwordHash = await bcrypt.hash(cleanPassword, 12);
    // A camada de banco escolhe Postgres na Vercel e SQLite no ambiente local.
    const user = await createUser({ name: cleanName, email: cleanEmail, passwordHash });

    // O cookie recebe um JWT assinado para autenticar as próximas requisições.
    const response = NextResponse.json({ user }, { status: 201 });
    response.cookies.set("finsight_token", await createToken(user), authCookie);
    return response;
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return NextResponse.json({ error: "Este e-mail já possui uma conta." }, { status: 409 });
    }

    // Registra o erro real apenas no servidor; a resposta pública permanece genérica.
    console.error("Falha ao registrar usuário", error);
    return NextResponse.json({ error: "Não foi possível criar a conta." }, { status: 500 });
  }
}
