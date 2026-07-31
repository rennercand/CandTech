import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function GET(request) {
  const user = await getSession(request);
  return user ? NextResponse.json({ user }) : NextResponse.json({ error: "Não autenticado" }, { status: 401 });
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set("finsight_token", "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
