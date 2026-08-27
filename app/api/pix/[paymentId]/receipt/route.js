import { NextResponse } from "next/server";
import { handleUpload } from "@vercel/blob/client";
import { getSession } from "@/lib/auth";
import { appendAuditEvent } from "@/lib/db";
import { getOrganizationAccess } from "@/lib/organization-access";
import { formatCents } from "@/lib/pix";
import { getLatestPixPayment, getOwnedPixPaymentForReceipt, savePixPaymentReceipt } from "@/lib/pix-db";
import { PIX_RECEIPT_MAX_BYTES, PixReceiptValidationError, normalizeReceiptFilename, validatePixReceipt } from "@/lib/pix-receipt";
import { deletePrivatePixReceipt, readPrivatePixReceipt, storePrivatePixReceipt } from "@/lib/pix-receipt-storage";
import { enforceRateLimit } from "@/lib/rate-limit";
import { guardMutation, readLimitedBytes, requestBodyErrorResponse } from "@/lib/request-security";
import { reportServerError } from "@/lib/server-observability";

export const runtime = "nodejs";

const allowedContentTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const publicIdPattern = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
const blobPathPattern = /^pix-receipts\/[0-9a-f-]{36}\.(pdf|jpg|png|webp)$/i;

function uploadedFilename(request) {
  const encoded = request.headers.get("x-file-name") || "";
  try { return decodeURIComponent(encoded); } catch { return ""; }
}

async function authorizedOwner(request, paymentId) {
  const limited = await enforceRateLimit(request, { scope: "pix-receipt-upload", limit: 8, windowMs: 60 * 60 * 1000 });
  if (limited) return { response: limited };
  const user = await getSession(request, { allowInactiveSubscription: true });
  if (!user) return { response: NextResponse.json({ error: "Não autenticado" }, { status: 401 }) };
  if (!user.isBillingOwner) return { response: NextResponse.json({ error: "Somente o proprietário pode enviar o comprovante." }, { status: 403 }) };
  if (!publicIdPattern.test(paymentId || "")) return { response: NextResponse.json({ error: "Pagamento não encontrado." }, { status: 404 }) };
  const payment = await getOwnedPixPaymentForReceipt({ id: paymentId, userId: user.id });
  if (!payment) return { response: NextResponse.json({ error: "Pagamento não encontrado." }, { status: 404 }) };
  if (!["pending", "payment_review"].includes(payment.status)) return { response: NextResponse.json({ error: "Este pagamento não aceita mais comprovantes." }, { status: 409 }) };
  if (new Date(payment.dueAt) <= new Date()) return { response: NextResponse.json({ error: "Este Pix venceu. Gere uma nova solicitação antes de enviar o comprovante." }, { status: 409 }) };
  return { user, payment };
}

async function auditUpload({ request, userId, paymentId, organizationId, receipt, replaced }) {
  await appendAuditEvent({
    userId,
    action: replaced ? "pix.receipt_replaced" : "pix.receipt_uploaded",
    metadata: { paymentId, organizationId, contentType: receipt.contentType, sizeBytes: receipt.sizeBytes },
  }).catch((error) => reportServerError(error, { request, route: "/api/pix/[paymentId]/receipt", operation: "audit-upload" }));
}

async function saveValidatedReceipt({ request, paymentId, user, payment, organizationId, storageKey, receipt }) {
  if (payment.receiptSha256 === receipt.sha256 && payment.receiptStorageKey === storageKey) return { duplicate: true };
  if (payment.receiptSha256 === receipt.sha256) {
    await deletePrivatePixReceipt(storageKey).catch((error) => reportServerError(error, { route: "/api/pix/[paymentId]/receipt", operation: "delete-duplicate-blob" }));
    return { duplicate: true };
  }
  const result = await savePixPaymentReceipt({
    id: paymentId, userId: user.id, organizationId, storageKey, ...receipt,
  });
  if (!result) return null;
  if (result.replacedStorageKey && result.replacedStorageKey !== storageKey) {
    await deletePrivatePixReceipt(result.replacedStorageKey).catch((error) => reportServerError(error, { route: "/api/pix/[paymentId]/receipt", operation: "delete-replaced-blob" }));
  }
  await auditUpload({ request, userId: user.id, paymentId, organizationId, receipt, replaced: Boolean(result.replacedStorageKey) });
  return result;
}

async function handleDirectLocalUpload(request, paymentId) {
  const blocked = guardMutation(request, { allowedContentTypes });
  if (blocked) return blocked;
  const access = await authorizedOwner(request, paymentId);
  if (access.response) return access.response;
  let storedKey = "";
  try {
    const bytes = await readLimitedBytes(request, { maxBytes: PIX_RECEIPT_MAX_BYTES });
    const receipt = validatePixReceipt({ bytes, filename: uploadedFilename(request), contentType: request.headers.get("content-type") });
    if (access.payment.receiptSha256 === receipt.sha256) {
      const payment = await getLatestPixPayment(access.user.id);
      return NextResponse.json({ payment: { ...payment, amount: formatCents(payment.amountCents) }, duplicate: true });
    }
    const organization = await getOrganizationAccess(access.user);
    storedKey = await storePrivatePixReceipt(receipt);
    const result = await saveValidatedReceipt({ request, paymentId, user: access.user, payment: access.payment,
      organizationId: organization?.organizationId || null, storageKey: storedKey, receipt });
    if (!result) {
      await deletePrivatePixReceipt(storedKey).catch(() => null);
      return NextResponse.json({ error: "Este pagamento mudou e não aceita mais o comprovante." }, { status: 409 });
    }
    storedKey = "";
    const payment = await getLatestPixPayment(access.user.id);
    return NextResponse.json({ payment: { ...payment, amount: formatCents(payment.amountCents) }, duplicate: Boolean(result.duplicate) },
      { status: result.duplicate ? 200 : 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (storedKey) await deletePrivatePixReceipt(storedKey).catch(() => null);
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    if (error instanceof PixReceiptValidationError) return NextResponse.json({ error: error.message }, { status: error.status });
    reportServerError(error, { request, route: "/api/pix/[paymentId]/receipt", operation: "upload-receipt-local" });
    return NextResponse.json({ error: "Não foi possível guardar o comprovante." }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  const { paymentId } = await params;
  const contentType = String(request.headers.get("content-type") || "").split(";", 1)[0].toLowerCase();
  // Desenvolvimento local conserva um caminho direto e privado. Em produção, o
  // navegador envia ao Blob para não esbarrar no limite de 4,5 MB das Functions.
  if (contentType !== "application/json") return handleDirectLocalUpload(request, paymentId);
  try {
    const body = await request.json();
    // A solicitação do navegador recebe proteção de origem. O callback assinado
    // do Blob vem da infraestrutura Vercel e é verificado pelo próprio SDK.
    if (body?.type === "blob.generate-client-token") {
      const blocked = guardMutation(request);
      if (blocked) return blocked;
    }
    const response = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const access = await authorizedOwner(request, paymentId);
        if (access.response) throw new Error(`UPLOAD_DENIED:${access.response.status}`);
        if (!blobPathPattern.test(pathname || "")) throw new PixReceiptValidationError("Destino de comprovante inválido.");
        let input;
        try { input = JSON.parse(clientPayload || "{}"); } catch { input = {}; }
        const originalFilename = normalizeReceiptFilename(input.originalFilename);
        const organization = await getOrganizationAccess(access.user);
        return {
          allowedContentTypes,
          maximumSizeInBytes: PIX_RECEIPT_MAX_BYTES,
          validUntil: Date.now() + 10 * 60 * 1000,
          addRandomSuffix: false,
          allowOverwrite: false,
          tokenPayload: JSON.stringify({ paymentId, userId: access.user.id, organizationId: organization?.organizationId || null,
            originalFilename, pathname, issuedAt: Date.now() }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        let payload;
        try { payload = JSON.parse(tokenPayload || "{}"); } catch { throw new Error("Payload assinado do comprovante inválido."); }
        if (payload.paymentId !== paymentId || !Number.isSafeInteger(payload.userId) || payload.pathname !== blob.pathname
          || !blobPathPattern.test(blob.pathname || "") || Date.now() - Number(payload.issuedAt || 0) > 60 * 60 * 1000) {
          await deletePrivatePixReceipt(blob.url).catch(() => null);
          throw new Error("Vínculo assinado do comprovante inválido.");
        }
        const payment = await getOwnedPixPaymentForReceipt({ id: paymentId, userId: payload.userId });
        if (!payment || !["pending", "payment_review"].includes(payment.status) || new Date(payment.dueAt) <= new Date()) {
          await deletePrivatePixReceipt(blob.url).catch(() => null);
          throw new Error("O pagamento não aceita mais este comprovante.");
        }
        const stored = await readPrivatePixReceipt(blob.url);
        if (!stored || stored.sizeBytes > PIX_RECEIPT_MAX_BYTES) {
          await deletePrivatePixReceipt(blob.url).catch(() => null);
          throw new PixReceiptValidationError("O comprovante deve ter no máximo 5 MB.", 413);
        }
        const bytes = await readLimitedBytes(new Response(stored.body, { headers: { "content-length": String(stored.sizeBytes) } }), { maxBytes: PIX_RECEIPT_MAX_BYTES });
        let receipt;
        try {
          receipt = validatePixReceipt({ bytes, filename: payload.originalFilename, contentType: blob.contentType });
        } catch (error) {
          await deletePrivatePixReceipt(blob.url).catch(() => null);
          throw error;
        }
        const result = await saveValidatedReceipt({ request, paymentId, user: { id: payload.userId }, payment,
          organizationId: payload.organizationId || null, storageKey: blob.url, receipt });
        if (!result) throw new Error("O pagamento mudou durante o envio do comprovante.");
      },
    });
    return NextResponse.json(response, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof PixReceiptValidationError) return NextResponse.json({ error: error.message }, { status: error.status });
    const deniedStatus = Number(String(error?.message || "").split("UPLOAD_DENIED:")[1]);
    if ([401, 403, 404, 409, 429].includes(deniedStatus)) return NextResponse.json({ error: "Envio não autorizado para este pagamento." }, { status: deniedStatus });
    reportServerError(error, { request, route: "/api/pix/[paymentId]/receipt", operation: "blob-client-upload" });
    return NextResponse.json({ error: "Não foi possível processar o comprovante." }, { status: 400 });
  }
}
