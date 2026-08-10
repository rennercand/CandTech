import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { appendAuditEvent, getBillingProfile, saveBillingProfile } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { guardMutation, readLimitedJson, requestBodyErrorResponse } from "@/lib/request-security";
import { normalizeBillingProfile } from "@/lib/profile-validation";
import { reportServerError } from "@/lib/observability";

export const runtime = "nodejs";

export async function GET(request) {
  const limited = await enforceRateLimit(request, { scope: "profile-read", limit: 60 });
  if (limited) return limited;
  const user = await getSession(request);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  return NextResponse.json(
    { profile: await getBillingProfile(user.id, user.accountType) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function PUT(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const limited = await enforceRateLimit(request, { scope: "profile-write", limit: 20 });
  if (limited) return limited;
  const user = await getSession(request);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  try {
    const input = await readLimitedJson(request, {
      maxBytes: 16_384, maxDepth: 3, maxNodes: 40, maxStringLength: 200,
    });
    const profile = normalizeBillingProfile(input);
    const saved = await saveBillingProfile({ userId: user.id, profile });
    await appendAuditEvent({ userId: user.id, action: "billing_profile.updated", metadata: { accountType: profile.accountType } });
    return NextResponse.json(
      { profile: saved },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    reportServerError(error, { request, route: "/api/profile", operation: "save" });
    return NextResponse.json({ error: "Não foi possível salvar os dados." }, { status: 500 });
  }
}
