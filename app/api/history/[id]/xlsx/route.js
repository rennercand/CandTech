import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findHistoryById, serializeHistory } from "@/lib/db";
import { historyXlsx, historyXlsxFilename } from "@/lib/history-xlsx";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  const limited = await enforceRateLimit(request, { scope: "xlsx", limit: 20 });
  if (limited) return limited;
  const user = await getSession(request);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  const row = await findHistoryById(Number(id), user.id);
  if (!row) return NextResponse.json({ error: "Registro não encontrado" }, { status: 404 });
  const item = serializeHistory(row);
  return new NextResponse(historyXlsx(item), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${historyXlsxFilename(item)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
