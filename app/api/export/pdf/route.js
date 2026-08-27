import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { historyPdf } from "@/lib/history-pdf";
import { enforceRateLimit } from "@/lib/rate-limit";
import { guardMutation, readLimitedJson, requestBodyErrorResponse } from "@/lib/request-security";
import { getOrganizationAccess } from "@/lib/organization-access";
import { filterHistoryForAccess, filterWorkspaceForAccess, hasPermission, permissionForCalculationType } from "@/lib/team-permissions";
import { reportServerError } from "@/lib/server-observability";
import { attachmentContentDisposition, safeExportFilename } from "@/lib/export-filename";

export const runtime = "nodejs";

export async function POST(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const limited = await enforceRateLimit(request, { scope: "pdf-export", limit: 20 });
  if (limited) return limited;
  const user = await getSession(request);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const access = await getOrganizationAccess(user);
  if (!hasPermission(access, "exports")) return NextResponse.json({ error: "Sem permissão para exportar." }, { status: 403 });
  if (Number(request.headers.get("content-length") || 0) > 512_000) {
    return NextResponse.json({ error: "Relatório muito grande" }, { status: 413 });
  }
  try {
    const { title, calculationType, payload, filename } = await readLimitedJson(request, {
      maxBytes: 512_000, maxDepth: 12, maxNodes: 8_000, maxStringLength: 20_000,
    });
    const safeTitle = String(title || "Relatório CandTech").trim().slice(0, 100);
    if (!payload || JSON.stringify(payload).length > 500_000) {
      return NextResponse.json({ error: "Não há dados calculados para o PDF." }, { status: 400 });
    }
    const safeType = String(calculationType || "relatório").slice(0, 50);
    const areaPermission = permissionForCalculationType(safeType);
    if (areaPermission && !hasPermission(access, areaPermission)) {
      return NextResponse.json({ error: "Sem permissão para exportar esta área." }, { status: 403 });
    }
    // Gera um relatório temporário e remove no servidor qualquer área não autorizada.
    const candidate = {
      id: "export",
      title: safeTitle,
      calculation_type: safeType,
      created_at: new Date().toISOString(),
      payload,
    };
    const report = areaPermission
      ? filterHistoryForAccess(candidate, access)
      : { ...candidate, payload: { ...payload, ...(payload.workspace ? { workspace: filterWorkspaceForAccess(payload.workspace, access) } : {}) } };
    const pdf = await historyPdf(report);
    return new NextResponse(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": attachmentContentDisposition(safeExportFilename(filename, "pdf", "relatorio-finsight.pdf")),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    reportServerError(error, { request, route: "/api/export/pdf", operation: "generate" });
    return NextResponse.json({ error: "Não foi possível gerar o PDF." }, { status: 500 });
  }
}
