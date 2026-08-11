import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sendEmailVerification } from "@/lib/auth-email";
import { findUserById } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { guardMutation } from "@/lib/request-security";
import { reportServerError } from "@/lib/observability";

export const runtime = "nodejs";

export async function POST(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const session = await getSession(request, { allowUnverified: true, allowInactiveSubscription: true });
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  const limited = await enforceRateLimit(request, {
    scope: "auth-resend-verification", limit: 3, windowMs: 30 * 60_000, identifier: session.email,
  });
  if (limited) return limited;
  try {
    const user = await findUserById(session.id);
    if (!user?.email_verification_required) return NextResponse.json({ message: "Seu e-mail já está confirmado." });
    const result = await sendEmailVerification({ user, request });
    if (!result.sent) return NextResponse.json({ error: "O envio de e-mail ainda não está configurado." }, { status: 503 });
    return NextResponse.json({ message: "Novo link enviado. Confira também a caixa de spam." });
  } catch (error) {
    reportServerError(error, { request, route: "/api/auth/resend-verification", operation: "resend-verification" });
    return NextResponse.json({ error: "Não foi possível reenviar a confirmação." }, { status: 500 });
  }
}
