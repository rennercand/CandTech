import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { deleteHistory } from "@/lib/db";

export const runtime = "nodejs";

export async function DELETE(request, { params }) {
  // Confirma a identidade antes de permitir a exclusão.
  const user = await getSession(request);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { id } = await params;
  // A exclusão inclui user.id para impedir que alguém apague dados de outra conta.
  const deleted = await deleteHistory(Number(id), user.id);
  return deleted
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "Registro não encontrado" }, { status: 404 });
}
