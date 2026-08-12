import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getAdminOverview } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { reportServerError } from "@/lib/server-observability";
import { getMonitoringAccessPath, isAdministrator } from "@/lib/admin-access";

export const runtime = "nodejs";

export async function GET(request) {
  const limited = await enforceRateLimit(request, { scope: "admin-overview", limit: 30 });
  if (limited) return limited;
  // O proprietário do sistema precisa consultar a operação mesmo durante a
  // configuração da cobrança; a autorização administrativa continua obrigatória.
  const user = await getSession(request, { allowInactiveSubscription: true });
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!isAdministrator(user.email)) return NextResponse.json({ error: "Acesso restrito" }, { status: 403 });

  try {
    const metrics = await getAdminOverview();
    const trafficLevel = metrics.peak_per_identity >= 100 ? "critical" : metrics.peak_per_identity >= 60 ? "attention" : "normal";
    return NextResponse.json({
      metrics,
      monitoringPath: getMonitoringAccessPath(),
      health: { database: "online", server: "online", trafficLevel, checkedAt: new Date().toISOString() },
      privacy: "Somente métricas agregadas; nenhum dado financeiro de usuários é consultado.",
    });
  } catch (error) {
    reportServerError(error, { request, route: "/api/admin/overview", operation: "read" });
    return NextResponse.json({ error: "Não foi possível consultar a saúde do sistema." }, { status: 500 });
  }
}
