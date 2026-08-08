import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { historyXlsx, historyXlsxFilename } from "@/lib/history-xlsx";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getAccessibleHistory } from "@/lib/organization-access";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  const limited = await enforceRateLimit(request, { scope: "xlsx", limit: 20 });
  if (limited) return limited;
  const user = await getSession(request);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  const { item, forbidden } = await getAccessibleHistory({ user, id, permissions: ["history", "exports"] });
  if (forbidden) return NextResponse.json({ error: "Sem permissão para exportar." }, { status: 403 });
  if (!item) return NextResponse.json({ error: "Registro não encontrado" }, { status: 404 });
  return new NextResponse(historyXlsx(item), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${historyXlsxFilename(item)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
