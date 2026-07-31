import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { authCookie, createToken } from "@/lib/auth";
import { findUserByEmail } from "@/lib/db";
import { allowAuthAttempt } from "@/lib/rate-limit";
import { guardMutation } from "@/lib/request-security";

// Mantém a rota no runtime Node.js, compatível com bcrypt e o banco.
export const runtime = "nodejs";

export async function POST(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  // Bloqueia abuso básico antes de consultar o banco e comparar a senha.
  if (!allowAuthAttempt(request)) {
    return NextResponse.json({ error: "Muitas tentativas. Aguarde um minuto." }, { status: 429 });
  }

  try {
    const { email, password } = await request.json();
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanPassword = String(password || "");
    if (cleanEmail.length > 254 || cleanPassword.length > 128) {
      return NextResponse.json({ error: "E-mail ou senha inválidos." }, { status: 401 });
    }
    // Procura pelo e-mail normalizado; a senha armazenada nunca vai para o cliente.
    const user = await findUserByEmail(cleanEmail);
    if (!user || !(await bcrypt.compare(cleanPassword, user.password_hash))) {
      return NextResponse.json({ error: "E-mail ou senha inválidos." }, { status: 401 });
    }

    // safeUser remove o hash antes de criar a resposta e o token.
    const safeUser = { id: user.id, name: user.name, email: user.email };
    const response = NextResponse.json({ user: safeUser });
    response.cookies.set("finsight_token", await createToken(safeUser), authCookie);
    return response;
  } catch (error) {
    // Mantém detalhes técnicos nos logs da Vercel, sem vazar informações ao usuário.
    console.error("Falha ao autenticar usuário", error);
    return NextResponse.json({ error: "Não foi possível entrar." }, { status: 500 });
  }
}
