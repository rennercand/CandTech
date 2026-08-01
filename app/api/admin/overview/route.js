import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getAdminOverview } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

function isAdministrator(email) {
  const allowed = String(process.env.ADMIN_EMAILS || "")
    .split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(String(email || "").toLowerCase());
}

export async function GET(request) {
  const limited = await enforceRateLimit(request, { scope: "admin-overview", limit: 30 });
  if (limited) return limited;
  const user = await getSession(request);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!isAdministrator(user.email)) return NextResponse.json({ error: "Acesso restrito" }, { status: 403 });

  try {
    const metrics = await getAdminOverview();
    const trafficLevel = metrics.peak_per_identity >= 100 ? "critical" : metrics.peak_per_identity >= 60 ? "attention" : "normal";
    return NextResponse.json({
      metrics,
      health: { database: "online", server: "online", trafficLevel, checkedAt: new Date().toISOString() },
      privacy: "Somente métricas agregadas; nenhum dado financeiro de usuários é consultado.",
    });
  } catch (error) {
    console.error(JSON.stringify({ level: "error", message: "admin_overview_failed", error: error.message }));
    return NextResponse.json({ error: "Não foi possível consultar a saúde do sistema." }, { status: 500 });
  }
}
