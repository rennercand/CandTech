import { NextResponse } from "next/server";
import { hashAuthActionToken } from "@/lib/auth-email";
import { appendAuditEvent, consumeEmailVerificationToken } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { guardMutation, readLimitedJson, requestBodyErrorResponse } from "@/lib/request-security";
import { reportServerError } from "@/lib/server-observability";

export const runtime = "nodejs";

export async function POST(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const limited = await enforceRateLimit(request, { scope: "auth-verify-ip", limit: 12, windowMs: 15 * 60_000 });
  if (limited) return limited;
  try {
    const { token } = await readLimitedJson(request, { maxBytes: 2_048, maxDepth: 2, maxNodes: 6, maxStringLength: 128 });
    const cleanToken = String(token || "");
    if (!/^[A-Za-z0-9_-]{40,100}$/.test(cleanToken)) {
      return NextResponse.json({ error: "Link de confirmação inválido." }, { status: 400 });
    }
    const user = await consumeEmailVerificationToken(hashAuthActionToken(cleanToken));
    if (!user) return NextResponse.json({ error: "Este link é inválido, expirou ou já foi usado." }, { status: 400 });
    await appendAuditEvent({
      userId: user.id, actorUserId: user.id, action: "account.email_verified", origin: "api/auth/verify-email",
      subjectType: "user", subjectId: user.id, previousState: { emailVerified: false }, newState: { emailVerified: true },
    });
    return NextResponse.json({ message: "E-mail confirmado com sucesso." });
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    reportServerError(error, { request, route: "/api/auth/verify-email", operation: "verify-email" });
    return NextResponse.json({ error: "Não foi possível confirmar o e-mail." }, { status: 500 });
  }
}
