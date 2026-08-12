import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { recordMonitoringEvent } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { guardMutation, readLimitedJson, requestBodyErrorResponse } from "@/lib/request-security";

export const runtime = "nodejs";

export async function POST(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const limited = await enforceRateLimit(request, { scope: "client-error", limit: 12 });
  if (limited) return limited;
  const user = await getSession(request, { allowUnverified: true, allowInactiveSubscription: true });
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  try {
    const body = await readLimitedJson(request, { maxBytes: 2_048, maxStringLength: 200 });
    const boundary = String(body.boundary || "unknown").replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || "unknown";
    const errorName = String(body.errorName || "Error").replace(/[^a-z0-9_-]/gi, "").slice(0, 80) || "Error";
    const route = String(body.route || "").startsWith("/") ? String(body.route).slice(0, 160) : "";
    await recordMonitoringEvent({
      fingerprint: `client:${route}:${boundary}:${errorName}:${String(body.digest || "").slice(0, 60)}`,
      level: "error",
      source: "browser",
      code: "ui_runtime_error",
      summary: `Falha na interface (${boundary}).`,
      route,
      details: { boundary, errorName },
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return requestBodyErrorResponse(error) || NextResponse.json({ error: "Não foi possível registrar o incidente." }, { status: 500 });
  }
}
