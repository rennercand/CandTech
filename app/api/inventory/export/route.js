import { getSession } from "@/lib/auth";
import { appendAuditEvent, getGoogleDriveConnection } from "@/lib/db";
import {
  decryptDriveToken,
  refreshDriveAccessToken,
  uploadFileToDrive,
} from "@/lib/google-drive";
import { listInventory } from "@/lib/inventory-db";
import { inventoryTenant } from "@/lib/inventory";
import { canExportInventory, inventoryCsv, inventoryFilename, inventoryXlsx } from "@/lib/inventory-report";
import { getOrganizationAccess } from "@/lib/organization-access";
import { enforceRateLimit } from "@/lib/rate-limit";
import { guardMutation, readLimitedJson, requestBodyErrorResponse } from "@/lib/request-security";
import { reportServerError } from "@/lib/server-observability";
import { attachmentContentDisposition, safeExportFilename } from "@/lib/export-filename";

export const runtime = "nodejs";

async function authorized(request, { drive = false } = {}) {
  const user = await getSession(request);
  if (!user) return { response: Response.json({ error: "Não autenticado" }, { status: 401 }) };
  const access = await getOrganizationAccess(user);
  if (!canExportInventory(access, { drive })) {
    return { response: Response.json({ error: "Sem permissão para exportar o estoque." }, { status: 403 }) };
  }
  return { user, access };
}

export async function GET(request) {
  const limited = await enforceRateLimit(request, { scope: "inventory-export", limit: 60 });
  if (limited) return limited;
  const auth = await authorized(request);
  if (auth.response) return auth.response;

  const requestUrl = new URL(request.url);
  const format = requestUrl.searchParams.get("format") === "csv" ? "csv" : "xlsx";
  const inventory = await listInventory(inventoryTenant(auth.access));
  const isCsv = format === "csv";
  const content = isCsv ? Buffer.from(`\ufeff${inventoryCsv(inventory)}`, "utf8") : inventoryXlsx(inventory);
  await appendAuditEvent({
    userId: auth.access.ownerUserId, actorUserId: auth.user.id, organizationId: auth.access.organizationId,
    action: "inventory.exported", origin: "api/inventory/export",
    subjectType: "inventory", subjectId: auth.access.organizationId || auth.access.ownerUserId,
    newState: { format, destination: "download", productCount: inventory.products.length },
  });
  return new Response(content, {
    headers: {
      "Content-Type": isCsv
        ? "text/csv; charset=utf-8"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": attachmentContentDisposition(safeExportFilename(requestUrl.searchParams.get("filename"), format, inventoryFilename(format))),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function POST(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const limited = await enforceRateLimit(request, { scope: "inventory-drive-upload", limit: 20 });
  if (limited) return limited;
  const auth = await authorized(request, { drive: true });
  if (auth.response) return auth.response;

  let requestedFilename = "";
  try {
    const body = await readLimitedJson(request, { maxBytes: 1_024, maxDepth: 2, maxNodes: 8, maxStringLength: 120 });
    requestedFilename = body.filename || "";
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    throw error;
  }

  const connection = await getGoogleDriveConnection(auth.user.id);
  if (!connection) {
    return Response.json(
      { error: "Conecte sua conta do Google Drive primeiro.", needsConnection: true },
      { status: 409 },
    );
  }

  try {
    const inventory = await listInventory(inventoryTenant(auth.access));
    const accessToken = await refreshDriveAccessToken(decryptDriveToken(connection.encrypted_refresh_token));
    const file = await uploadFileToDrive({
      accessToken,
      filename: safeExportFilename(requestedFilename, "xlsx", inventoryFilename("xlsx")),
      content: inventoryXlsx(inventory),
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    await appendAuditEvent({
      userId: auth.access.ownerUserId, actorUserId: auth.user.id, organizationId: auth.access.organizationId,
      action: "inventory.exported", origin: "api/inventory/export",
      subjectType: "inventory", subjectId: auth.access.organizationId || auth.access.ownerUserId,
      newState: { format: "xlsx", destination: "google_drive", productCount: inventory.products.length, providerFileId: file?.id || null },
    });
    return Response.json({ file });
  } catch (error) {
    const reconnect = error?.code === "invalid_grant";
    reportServerError(error, { request, route: "/api/inventory/export", operation: "drive-upload", status: reconnect ? 401 : 502 });
    return Response.json({
      error: reconnect
        ? "A autorização do Google expirou. Conecte o Drive novamente."
        : "Não foi possível enviar o estoque ao Google Drive.",
      reconnect,
      needsConnection: reconnect,
    }, { status: reconnect ? 401 : 502 });
  }
}
