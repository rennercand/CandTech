import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findHistoryById, serializeHistory } from "@/lib/db";
import { historyPdf, historyPdfFilename } from "@/lib/history-pdf";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  const limited = await enforceRateLimit(request, { scope: "pdf", limit: 20 });
  if (limited) return limited;
  const user = await getSession(request);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  // O PDF só é criado quando o ID e o usuário da sessão correspondem ao mesmo registro.
  const row = await findHistoryById(Number(id), user.id);
  if (!row) return NextResponse.json({ error: "Registro não encontrado" }, { status: 404 });
  const item = serializeHistory(row);
  const pdf = await historyPdf(item);
  return new NextResponse(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${historyPdfFilename(item)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
