import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { historyXlsx, historyXlsxFilename } from "@/lib/history-xlsx";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getAccessibleHistory } from "@/lib/organization-access";
import { attachmentContentDisposition, safeExportFilename } from "@/lib/export-filename";
import { appendAuditEvent } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  const limited = await enforceRateLimit(request, { scope: "xlsx", limit: 20 });
  if (limited) return limited;
  const user = await getSession(request);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  const { access, item, forbidden } = await getAccessibleHistory({ user, id, permissions: ["history", "exports"] });
  if (forbidden) return NextResponse.json({ error: "Sem permissão para exportar." }, { status: 403 });
  if (!item) return NextResponse.json({ error: "Registro não encontrado" }, { status: 404 });
  const filename = safeExportFilename(new URL(request.url).searchParams.get("filename"), "xlsx", historyXlsxFilename(item));
  await appendAuditEvent({
    userId: access.ownerUserId, actorUserId: user.id, organizationId: access.organizationId,
    action: "history.exported", origin: "api/history/:id/xlsx",
    subjectType: "history", subjectId: item.id,
    newState: { format: "xlsx", destination: "download" },
  });
  return new NextResponse(historyXlsx(item), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": attachmentContentDisposition(filename),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
