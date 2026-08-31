import { NextResponse } from "next/server";
import { getAdministratorAccess } from "@/lib/admin-access";
import { getSession } from "@/lib/auth";
import { appendAuditEvent } from "@/lib/db";
import { getActivePixReceiptForAdmin } from "@/lib/pix-db";
import { readPrivatePixReceipt } from "@/lib/pix-receipt-storage";
import { enforceRateLimit } from "@/lib/rate-limit";
import { reportServerError } from "@/lib/server-observability";
import { hasVerifiedMfa, mfaRequiredResponse } from "@/lib/mfa-access";

export const runtime = "nodejs";
const publicIdPattern = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;

function contentDisposition(filename, download) {
  const fallback = String(filename || "comprovante")
    .normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/["\\]/g, "_").slice(0, 120) || "comprovante";
  return `${download ? "attachment" : "inline"}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename || fallback)}`;
}

export async function GET(request, { params }) {
  const limited = await enforceRateLimit(request, { scope: "admin-pix-receipt", limit: 120 });
  if (limited) return limited;
  const user = await getSession(request, { allowInactiveSubscription: true });
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!user.legalAccepted) return NextResponse.json({ error: "Aceite jurídico pendente." }, { status: 403 });
  const access = await getAdministratorAccess(user);
  if (!access.canBilling) return NextResponse.json({ error: "Acesso restrito" }, { status: 403 });
  if (!hasVerifiedMfa(user)) return mfaRequiredResponse();

  const { paymentId } = await params;
  if (!publicIdPattern.test(String(paymentId || ""))) {
    return NextResponse.json({ error: "Comprovante não encontrado." }, { status: 404 });
  }
  try {
    const receipt = await getActivePixReceiptForAdmin(String(paymentId || ""));
    if (!receipt) return NextResponse.json({ error: "Comprovante não encontrado." }, { status: 404 });
    const file = await readPrivatePixReceipt(receipt.storageKey);
    if (!file) return NextResponse.json({ error: "Arquivo do comprovante não encontrado." }, { status: 404 });
    await appendAuditEvent({
      userId: receipt.userId,
      actorUserId: user.id,
      organizationId: receipt.organizationId,
      action: "pix.receipt_viewed",
      origin: "api/admin/payments/receipt",
      subjectType: "pix_payment_receipt",
      subjectId: receipt.id,
      metadata: { paymentId: receipt.paymentId },
    }).catch((error) => reportServerError(error, { request, route: "/api/admin/payments/[paymentId]/receipt", operation: "audit-view" }));
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new Response(file.body, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": contentDisposition(receipt.originalFilename, download),
        "Content-Length": String(receipt.sizeBytes),
        "Content-Security-Policy": "sandbox",
        "Content-Type": receipt.contentType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    reportServerError(error, { request, route: "/api/admin/payments/[paymentId]/receipt", operation: "read-receipt" });
    return NextResponse.json({ error: "Não foi possível abrir o comprovante." }, { status: 500 });
  }
}
