import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getAdminOverview } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { reportServerError } from "@/lib/server-observability";
import { getAdministratorAccess, getMonitoringAccessPath } from "@/lib/admin-access";

export const runtime = "nodejs";

export async function GET(request) {
  const limited = await enforceRateLimit(request, { scope: "admin-overview", limit: 30 });
  if (limited) return limited;
  // O proprietário do sistema precisa consultar a operação mesmo durante a
  // configuração da cobrança; a autorização administrativa continua obrigatória.
  const user = await getSession(request, { allowInactiveSubscription: true });
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!user.legalAccepted) return NextResponse.json({ error: "Aceite jurídico pendente." }, { status: 403 });
  const access = await getAdministratorAccess(user);
  if (!access.isStaff) return NextResponse.json({ error: "Acesso restrito" }, { status: 403 });

  try {
    // Suporte e cobrança recebem o atalho da central, mas não métricas globais
    // que não são necessárias para executar suas tarefas.
    if (!access.canMonitor) {
      return NextResponse.json({
        restricted: true,
        monitoringPath: getMonitoringAccessPath(),
        permissions: access,
        privacy: "A conta possui somente acesso operacional aos módulos concedidos.",
      }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const metrics = await getAdminOverview();
    const trafficLevel = metrics.peak_per_identity >= 100 ? "critical" : metrics.peak_per_identity >= 60 ? "attention" : "normal";
    return NextResponse.json({
      metrics,
      monitoringPath: getMonitoringAccessPath(),
      permissions: access,
      health: { database: "online", server: "online", trafficLevel, checkedAt: new Date().toISOString() },
      privacy: "Somente métricas agregadas; nenhum dado financeiro de usuários é consultado.",
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    reportServerError(error, { request, route: "/api/admin/overview", operation: "read" });
    return NextResponse.json({ error: "Não foi possível consultar a saúde do sistema." }, { status: 500 });
  }
}
