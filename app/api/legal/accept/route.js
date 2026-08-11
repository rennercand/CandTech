import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { appendAuditEvent, recordLegalAcceptance } from "@/lib/db";
import { PRIVACY_VERSION, TERMS_VERSION } from "@/lib/legal";
import { enforceRateLimit } from "@/lib/rate-limit";
import { guardMutation, readLimitedJson, requestBodyErrorResponse } from "@/lib/request-security";
import { reportServerError } from "@/lib/observability";

export const runtime = "nodejs";

export async function POST(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const user = await getSession(request);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const limited = await enforceRateLimit(request, { scope: "legal-accept", limit: 10, identifier: user.id });
  if (limited) return limited;
  try {
    const { accepted } = await readLimitedJson(request, { maxBytes: 512, maxDepth: 2, maxNodes: 4, maxStringLength: 32 });
    if (accepted !== true) return NextResponse.json({ error: "O aceite precisa ser expresso." }, { status: 400 });
    const acceptedAt = new Date().toISOString();
    await recordLegalAcceptance({ userId: user.id, acceptedAt, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION });
    await appendAuditEvent({ userId: user.id, action: "legal.accepted", metadata: { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION } });
    return NextResponse.json({ ok: true, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION });
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    reportServerError(error, { request, route: "/api/legal/accept", operation: "accept-legal" });
    return NextResponse.json({ error: "Não foi possível registrar o aceite." }, { status: 500 });
  }
}
