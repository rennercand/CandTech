import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { historyCsv, historyCsvFilename } from "@/lib/history-csv";
import { getAccessibleHistory } from "@/lib/organization-access";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  const limited = await enforceRateLimit(request, { scope: "csv", limit: 20 });
  if (limited) return limited;
  const user = await getSession(request);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { id } = await params;
  const { item, forbidden } = await getAccessibleHistory({ user, id, permissions: ["history", "exports"] });
  if (forbidden) return NextResponse.json({ error: "Sem permissão para exportar." }, { status: 403 });
  if (!item) return NextResponse.json({ error: "Registro não encontrado" }, { status: 404 });
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
