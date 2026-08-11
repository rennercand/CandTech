import { NextResponse } from "next/server";
import { findUserByEmail } from "@/lib/db";
import { sendPasswordReset } from "@/lib/auth-email";
import { enforceRateLimit } from "@/lib/rate-limit";
import { guardMutation, readLimitedJson, requestBodyErrorResponse } from "@/lib/request-security";
import { reportServerError } from "@/lib/observability";

export const runtime = "nodejs";
const GENERIC_MESSAGE = "Se o e-mail estiver cadastrado, você receberá um link em alguns minutos.";

export async function POST(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const limited = await enforceRateLimit(request, { scope: "auth-forgot-ip", limit: 5, windowMs: 15 * 60_000 });
  if (limited) return limited;
  try {
    const { email } = await readLimitedJson(request, { maxBytes: 2_048, maxDepth: 2, maxNodes: 8, maxStringLength: 254 });
    const cleanEmail = String(email || "").trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(cleanEmail) || cleanEmail.length > 254) {
      return NextResponse.json({ message: GENERIC_MESSAGE });
    }
    const accountLimited = await enforceRateLimit(request, {
      scope: "auth-forgot-account", limit: 3, windowMs: 30 * 60_000, identifier: cleanEmail,
    });
    if (accountLimited) return NextResponse.json({ message: GENERIC_MESSAGE });
    const user = await findUserByEmail(cleanEmail);
    if (user) {
      try {
        await sendPasswordReset({ user, request });
      } catch (error) {
        reportServerError(error, { request, route: "/api/auth/forgot-password", operation: "send-reset-email" });
      }
    }
    return NextResponse.json({ message: GENERIC_MESSAGE });
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    reportServerError(error, { request, route: "/api/auth/forgot-password", operation: "forgot-password" });
    return NextResponse.json({ message: GENERIC_MESSAGE });
  }
}
