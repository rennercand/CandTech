import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { appendAuditEvent } from "@/lib/db";
import { requirePermission } from "@/lib/organization-access";
import { inventoryTenant } from "@/lib/inventory";
import { getDeliveryProof, saveDeliveryProof } from "@/lib/inventory-db";
import { validatePixReceipt, PixReceiptValidationError } from "@/lib/pix-receipt";
import { deleteDeliveryProof, readDeliveryProof, storeDeliveryProof } from "@/lib/delivery-proof-storage";
import { guardMutation, readLimitedBytes, requestBodyErrorResponse } from "@/lib/request-security";
import { enforceRateLimit } from "@/lib/rate-limit";
import { reportServerError } from "@/lib/server-observability";

export const runtime = "nodejs";
const MAX_BYTES = 4 * 1024 * 1024;
const allowedContentTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const idPattern = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;

async function authorize(request, deliveryId) {
  const user = await getSession(request);
  if (!user) return { response: NextResponse.json({ error: "Não autenticado" }, { status: 401 }) };
  const access = await requirePermission(user, "inventory");
  if (!access) return { response: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };
  if (!idPattern.test(deliveryId || "")) return { response: NextResponse.json({ error: "Entrega não encontrada" }, { status: 404 }) };
  return { user, access, tenantId: inventoryTenant(access) };
}

export async function PUT(request, { params }) {
  const { deliveryId } = await params;
  const blocked = guardMutation(request, { allowedContentTypes });
  if (blocked) return blocked;
  const limited = await enforceRateLimit(request, { scope: "delivery-proof", limit: 12, windowMs: 60 * 60 * 1000 });
  if (limited) return limited;
  const auth = await authorize(request, deliveryId);
  if (auth.response) return auth.response;
  let storedKey = "";
  try {
    const bytes = await readLimitedBytes(request, { maxBytes: MAX_BYTES });
    const filename = decodeURIComponent(request.headers.get("x-file-name") || "comprovante.pdf");
    const proof = validatePixReceipt({ bytes, filename, contentType: request.headers.get("content-type") });
    storedKey = await storeDeliveryProof(proof);
    const previous = await getDeliveryProof({ tenantId: auth.tenantId, deliveryId });
    const saved = await saveDeliveryProof({ tenantId: auth.tenantId, deliveryId, storageKey: storedKey });
    if (!saved) {
      await deleteDeliveryProof(storedKey).catch(() => null);
      return NextResponse.json({ error: "Entrega não encontrada" }, { status: 404 });
    }
    storedKey = "";
    if (previous?.proof_blob_path) await deleteDeliveryProof(previous.proof_blob_path).catch(() => null);
    await appendAuditEvent({ userId: auth.access.ownerUserId, actorUserId: auth.user.id, organizationId: auth.access.organizationId,
      action: previous?.proof_blob_path ? "delivery.proof_replaced" : "delivery.proof_uploaded", origin: "api/inventory/delivery-proof",
      subjectType: "operational_delivery", subjectId: deliveryId,
      previousState: previous?.proof_blob_path ? { activeProof: true } : null,
      newState: { activeProof: true, contentType: proof.contentType, sizeBytes: proof.sizeBytes } }).catch(() => null);
    return NextResponse.json({ uploaded: true }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (storedKey) await deleteDeliveryProof(storedKey).catch(() => null);
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    if (error instanceof PixReceiptValidationError) return NextResponse.json({ error: error.message }, { status: error.status });
    reportServerError(error, { request, route: "/api/inventory/deliveries/[deliveryId]/proof", operation: "upload" });
    return NextResponse.json({ error: "Não foi possível guardar o comprovante" }, { status: 500 });
  }
}

export async function GET(request, { params }) {
  const { deliveryId } = await params;
  const auth = await authorize(request, deliveryId);
  if (auth.response) return auth.response;
  const row = await getDeliveryProof({ tenantId: auth.tenantId, deliveryId });
  if (!row?.proof_blob_path) return NextResponse.json({ error: "Comprovante não encontrado" }, { status: 404 });
  const proof = await readDeliveryProof(row.proof_blob_path);
  if (!proof) return NextResponse.json({ error: "Comprovante não encontrado" }, { status: 404 });
  return new Response(proof.body, { headers: { "Content-Type": proof.contentType || "application/octet-stream", "Content-Disposition": "attachment; filename=\"comprovante-entrega\"", "Cache-Control": "private, no-store" } });
}
