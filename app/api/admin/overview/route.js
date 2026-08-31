import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getAdminOverview } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { reportServerError } from "@/lib/server-observability";
import { getAdministratorAccess, getMonitoringAccessPath } from "@/lib/admin-access";
import { hasVerifiedMfa, mfaRequiredResponse } from "@/lib/mfa-access";

export const runtime = "nodejs";

export async function GET(request) {
  const limited = await enforceRateLimit(request, { scope: "admin-overview", limit: 30 });
  if (limited) return limited;
  const user = await getSession(request, { allowInactiveSubscription: true });
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!user.legalAccepted) return NextResponse.json({ error: "Aceite jurídico pendente." }, { status: 403 });
  const access = await getAdministratorAccess(user);
  if (!access.isStaff) return NextResponse.json({ error: "Acesso restrito" }, { status: 403 });
  if (!hasVerifiedMfa(user)) return mfaRequiredResponse();

  const privateView = new URL(request.url).searchParams.get("private") === "1";

  try {
    // Esta visão contém métricas globais da plataforma. Ela só pode ser usada
    // pela conta proprietária explicitamente autorizada e somente na central privada.
    if (!privateView || !access.canViewSystemOverview) {
      return NextResponse.json({
        restricted: true,
        monitoringPath: getMonitoringAccessPath(),
        permissions: access,
        privacy: "As métricas globais da plataforma ficam disponíveis somente na central privada da conta proprietária autorizada.",
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
