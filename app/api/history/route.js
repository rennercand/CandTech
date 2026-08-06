import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listHistories, MAX_DOCUMENTS_PER_USER, saveHistory, serializeHistory } from "@/lib/db";
import { guardMutation, readLimitedJson, requestBodyErrorResponse } from "@/lib/request-security";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET(request) {
  const limited = await enforceRateLimit(request, { scope: "history-read", limit: 120 });
  if (limited) return limited;
  // Toda consulta de histórico exige uma sessão válida.
  const user = await getSession(request);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const type = new URL(request.url).searchParams.get("type");
  // O user.id impede que uma conta leia registros pertencentes a outra.
  const rows = await listHistories(user.id, type);
  return NextResponse.json({ items: rows.map(serializeHistory) });
}

export async function POST(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const limited = await enforceRateLimit(request, { scope: "history-write", limit: 30 });
  if (limited) return limited;
  const user = await getSession(request);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const contentLength = Number(request.headers.get("content-length") || 0);
  // Rejeita históricos excessivamente grandes antes de carregar o corpo inteiro.
  if (contentLength > 512_000) {
    return NextResponse.json({ error: "Histórico muito grande" }, { status: 413 });
  }

  try {
    const { id, title, calculationType, payload } = await readLimitedJson(request, {
      maxBytes: 512_000, maxDepth: 12, maxNodes: 12_000, maxStringLength: 20_000,
    });
    const safeId = Number(id);
    const safeTitle = String(title || "").trim().slice(0, 100);
    const safeType = String(calculationType || "").trim().slice(0, 50);
    if (!safeTitle || !safeType || !payload || JSON.stringify(payload).length > 500_000) {
      return NextResponse.json({ error: "Histórico inválido ou muito grande." }, { status: 400 });
    }

    // Com um ID ativo, salvar atualiza o mesmo documento em vez de criar cópias no histórico.
    const saved = await saveHistory({
      id: Number.isInteger(safeId) && safeId > 0 ? safeId : null,
      userId: user.id,
      title: safeTitle,
      calculationType: safeType,
      payload,
    });
    return NextResponse.json(
      { item: serializeHistory(saved.item), created: saved.created, limit: MAX_DOCUMENTS_PER_USER },
      { status: saved.created ? 201 : 200 },
    );
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    if (error?.code === "DOCUMENT_LIMIT_REACHED") {
      return NextResponse.json(
        { error: `Você atingiu o limite de ${MAX_DOCUMENTS_PER_USER} documentos. Exclua um documento antigo para criar outro.` },
        { status: 409 },
      );
    }
    console.error("Falha ao salvar histórico", error);
    return NextResponse.json({ error: "Não foi possível salvar o histórico." }, { status: 500 });
  }
}
