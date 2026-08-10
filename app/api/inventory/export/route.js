import { getSession } from "@/lib/auth";
import { getGoogleDriveConnection } from "@/lib/db";
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
import { guardMutation } from "@/lib/request-security";
import { reportServerError } from "@/lib/observability";

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

  const format = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "xlsx";
  const inventory = await listInventory(inventoryTenant(auth.access));
  const isCsv = format === "csv";
  const content = isCsv ? Buffer.from(`\ufeff${inventoryCsv(inventory)}`, "utf8") : inventoryXlsx(inventory);
  return new Response(content, {
    headers: {
      "Content-Type": isCsv
        ? "text/csv; charset=utf-8"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${inventoryFilename(format)}"`,
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
      filename: inventoryFilename("xlsx"),
      content: inventoryXlsx(inventory),
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
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
