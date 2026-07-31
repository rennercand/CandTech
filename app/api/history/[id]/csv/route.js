import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findHistoryById, serializeHistory } from "@/lib/db";

export const runtime = "nodejs";

function value(item) {
  if (item === null || item === undefined) return "";
  let text = String(item);
  // Evita CSV injection: o Excel não interpreta conteúdo salvo como fórmula.
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return text.replaceAll('"', '""');
}

export async function GET(request, { params }) {
  const user = await getSession(request);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { id } = await params;
  // Busca pelo id e pelo dono do registro antes de gerar o arquivo.
  const row = await findHistoryById(Number(id), user.id);
  if (!row) return NextResponse.json({ error: "Registro não encontrado" }, { status: 404 });

  const item = serializeHistory(row);
  const rows = item.payload.table || item.payload.entries || [];
  const headers = rows.length ? Object.keys(rows[0]) : ["resumo"];
  // Cada linha é cercada por aspas e usa ponto e vírgula, formato comum no Excel em pt-BR.
  const csv = [
    ["Título", item.title],
    ["Tipo", item.calculation_type],
    ["Criado em", item.created_at],
    [],
    headers,
    ...rows.map((rowItem) => headers.map((header) => rowItem[header])),
  ].map((line) => line.map((cell) => `"${value(cell)}"`).join(";")).join("\r\n");

  return new NextResponse(`\ufeff${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="historico-${item.id}.csv"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
