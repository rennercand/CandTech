import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findHistoryById, serializeHistory } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { historyCsv, historyCsvFilename } from "@/lib/history-csv";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  const limited = await enforceRateLimit(request, { scope: "csv", limit: 20 });
  if (limited) return limited;
  const user = await getSession(request);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { id } = await params;
  // Busca pelo id e pelo dono do registro antes de gerar o arquivo.
  const row = await findHistoryById(Number(id), user.id);
  if (!row) return NextResponse.json({ error: "Registro não encontrado" }, { status: 404 });

  const item = serializeHistory(row);
  const csv = historyCsv(item);

  return new NextResponse(`\ufeff${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${historyCsvFilename(item)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
