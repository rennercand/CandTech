import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { deleteHistory } from "@/lib/db";
import { guardMutation } from "@/lib/request-security";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getAccessibleHistory } from "@/lib/organization-access";

export const runtime = "nodejs";

export async function DELETE(request, { params }) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const limited = await enforceRateLimit(request, { scope: "history-delete", limit: 30 });
  if (limited) return limited;
  // Confirma a identidade antes de permitir a exclusão.
  const user = await getSession(request);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { id } = await params;
  const { access, item, forbidden } = await getAccessibleHistory({ user, id, permissions: ["history"] });
  if (forbidden) return NextResponse.json({ error: "Sem permissão para alterar o histórico." }, { status: 403 });
  if (!item) return NextResponse.json({ error: "Registro não encontrado" }, { status: 404 });
  // A exclusão inclui user.id para impedir que alguém apague dados de outra conta.
  const deleted = await deleteHistory(id, access.ownerUserId, access.organizationId);
  return deleted
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "Registro não encontrado" }, { status: 404 });
}
