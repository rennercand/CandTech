import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { historyPdf } from "@/lib/history-pdf";
import { enforceRateLimit } from "@/lib/rate-limit";
import { guardMutation, readLimitedJson, requestBodyErrorResponse } from "@/lib/request-security";

export const runtime = "nodejs";

export async function POST(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const limited = await enforceRateLimit(request, { scope: "pdf-export", limit: 20 });
  if (limited) return limited;
  const user = await getSession(request);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (Number(request.headers.get("content-length") || 0) > 512_000) {
    return NextResponse.json({ error: "Relatório muito grande" }, { status: 413 });
  }
  try {
    const { title, calculationType, payload } = await readLimitedJson(request, {
      maxBytes: 512_000, maxDepth: 12, maxNodes: 8_000, maxStringLength: 20_000,
    });
    const safeTitle = String(title || "Relatório CandTech").trim().slice(0, 100);
    if (!payload || JSON.stringify(payload).length > 500_000) {
      return NextResponse.json({ error: "Não há dados calculados para o PDF." }, { status: 400 });
    }
    // Gera um relatório temporário sem criar um novo item no Histórico.
    const pdf = await historyPdf({
      id: "export",
      title: safeTitle,
      calculation_type: String(calculationType || "relatório").slice(0, 50),
      created_at: new Date().toISOString(),
      payload,
    });
    return new NextResponse(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="relatorio-finsight.pdf"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    console.error("Falha ao gerar PDF da aba", error);
    return NextResponse.json({ error: "Não foi possível gerar o PDF." }, { status: 500 });
  }
}
