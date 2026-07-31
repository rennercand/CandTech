import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createHistory, listHistories, serializeHistory } from "@/lib/db";
import { guardMutation } from "@/lib/request-security";

export const runtime = "nodejs";

export async function GET(request) {
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
  const user = await getSession(request);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const contentLength = Number(request.headers.get("content-length") || 0);
  // Rejeita históricos excessivamente grandes antes de carregar o corpo inteiro.
  if (contentLength > 512_000) {
    return NextResponse.json({ error: "Histórico muito grande" }, { status: 413 });
  }

  try {
    const { title, calculationType, payload } = await request.json();
    const safeTitle = String(title || "").trim().slice(0, 100);
    const safeType = String(calculationType || "").trim().slice(0, 50);
    if (!safeTitle || !safeType || !payload || JSON.stringify(payload).length > 500_000) {
      return NextResponse.json({ error: "Histórico inválido ou muito grande." }, { status: 400 });
    }

    // Salva e devolve o registro criado por meio da camada de banco.
    const item = await createHistory({
      userId: user.id,
      title: safeTitle,
      calculationType: safeType,
      payload,
    });
    return NextResponse.json({ item: serializeHistory(item) }, { status: 201 });
  } catch (error) {
    console.error("Falha ao salvar histórico", error);
    return NextResponse.json({ error: "Não foi possível salvar o histórico." }, { status: 500 });
  }
}
