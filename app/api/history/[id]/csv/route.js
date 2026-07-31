import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findHistoryById, serializeHistory } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const HEADER_LABELS = {
  period: "Período",
  date: "Data",
  flow: "Fluxo",
  discounted: "Valor presente",
  accumulated: "Acumulado",
  openingBalance: "Saldo inicial",
  payment: "Prestação",
  interest: "Juros",
  amortization: "Amortização",
  balance: "Saldo final",
};

function excelCell(item) {
  if (item === null || item === undefined) return "";
  // Números ficam sem aspas e com vírgula decimal para o Excel pt-BR reconhecê-los.
  if (typeof item === "number" && Number.isFinite(item)) {
    return String(item).replace(".", ",");
  }
  let text = String(item);
  // Evita CSV injection: conteúdo do usuário nunca deve virar fórmula no Excel.
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function csvLine(cells) {
  return cells.map(excelCell).join(";");
}

function tableSection(title, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const headers = Object.keys(rows[0]);
  return [
    [title],
    headers.map((header) => HEADER_LABELS[header] || header),
    ...rows.map((row) => headers.map((header) => row[header])),
    [],
  ];
}

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
  const calculationRows = item.payload.table || item.payload.entries || [];
  const financing = item.payload.financialTable;
  const lines = [
    ["Título", item.title],
    ["Tipo", item.calculation_type],
    ["Criado em", item.created_at],
    [],
    ...tableSection("Fluxo e memória do cálculo", calculationRows),
    ...tableSection(
      financing ? `Tabela financeira - ${financing.state?.system || ""}` : "",
      financing?.result?.rows,
    ),
  ];
  // sep=; manda o Excel respeitar o separador mesmo quando o Windows usa outra configuração regional.
  const csv = ["sep=;", ...lines.map(csvLine)].join("\r\n");

  return new NextResponse(`\ufeff${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="historico-${item.id}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
