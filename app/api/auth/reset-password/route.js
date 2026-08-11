import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { hashAuthActionToken } from "@/lib/auth-email";
import { appendAuditEvent, resetPasswordWithToken } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { guardMutation, readLimitedJson, requestBodyErrorResponse } from "@/lib/request-security";
import { reportServerError } from "@/lib/observability";

export const runtime = "nodejs";

export async function POST(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const limited = await enforceRateLimit(request, { scope: "auth-reset-ip", limit: 8, windowMs: 15 * 60_000 });
  if (limited) return limited;
  try {
    const { token, password } = await readLimitedJson(request, { maxBytes: 4_096, maxDepth: 2, maxNodes: 10, maxStringLength: 256 });
    const cleanToken = String(token || "");
    const cleanPassword = String(password || "");
    if (!/^[A-Za-z0-9_-]{40,100}$/.test(cleanToken) || cleanPassword.length < 8 || cleanPassword.length > 128) {
      return NextResponse.json({ error: "Link inválido ou senha fora do limite de 8 a 128 caracteres." }, { status: 400 });
    }
    const passwordHash = await bcrypt.hash(cleanPassword, 12);
    const user = await resetPasswordWithToken({ tokenHash: hashAuthActionToken(cleanToken), passwordHash });
    if (!user) return NextResponse.json({ error: "Este link é inválido, expirou ou já foi usado." }, { status: 400 });
    await appendAuditEvent({ userId: user.id, action: "account.password_reset" });
    return NextResponse.json({ message: "Senha atualizada. Entre novamente com a nova senha." });
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    reportServerError(error, { request, route: "/api/auth/reset-password", operation: "reset-password" });
    return NextResponse.json({ error: "Não foi possível redefinir a senha." }, { status: 500 });
  }
}
