import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { authCookie, createToken } from "@/lib/auth";
import { createUser, isUniqueConstraintError } from "@/lib/db";
import { allowAuthAttempt } from "@/lib/rate-limit";

// Força o uso do runtime Node.js, necessário para bcrypt e para o banco.
export const runtime = "nodejs";

export async function POST(request) {
  // Limita tentativas repetidas antes de executar operações mais caras.
  if (!allowAuthAttempt(request)) {
    return NextResponse.json({ error: "Muitas tentativas. Aguarde um minuto." }, { status: 429 });
  }

  try {
    // Normaliza os campos para salvar dados consistentes e validar limites.
    const { name, email, password } = await request.json();
    const cleanName = String(name || "").trim().slice(0, 80);
    const cleanEmail = String(email || "").trim().toLowerCase();
    if (cleanName.length < 2 || !/^\S+@\S+\.\S+$/.test(cleanEmail) || String(password || "").length < 8) {
      return NextResponse.json(
        { error: "Informe nome, e-mail válido e senha com ao menos 8 caracteres." },
        { status: 400 },
      );
    }

    // bcrypt adiciona um salt e transforma a senha em um hash irreversível.
    const passwordHash = await bcrypt.hash(password, 12);
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
