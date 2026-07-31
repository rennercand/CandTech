import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { guardMutation } from "@/lib/request-security";
import { enforceRateLimit } from "@/lib/rate-limit";

export async function GET(request) {
  const limited = await enforceRateLimit(request, { scope: "session", limit: 120 });
  if (limited) return limited;
  const user = await getSession(request);
  return user ? NextResponse.json({ user }) : NextResponse.json({ error: "Não autenticado" }, { status: 401 });
}

export async function DELETE(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const limited = await enforceRateLimit(request, { scope: "session", limit: 30 });
  if (limited) return limited;
  const response = NextResponse.json({ ok: true });
  response.cookies.set("finsight_token", "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
