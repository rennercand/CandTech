import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getAdministratorAccess, isMonitoringAccessKey } from "@/lib/admin-access";
import MonitoringPortal from "../../admin/monitoramento/portal";
import { hasVerifiedMfa } from "@/lib/mfa-access";

export const metadata = {
  title: "Monitoramento privado",
  robots: { index: false, follow: false, nocache: true },
};

export default async function MonitoringPage({ params }) {
  const { accessKey } = await params;
  // Chave incorreta não revela se a central existe nem inicia consultas privadas.
  if (!isMonitoringAccessKey(accessKey)) notFound();
  const cookieStore = await cookies();
  const user = await getSession({ cookies: cookieStore }, { allowInactiveSubscription: true });
  if (!user) redirect("/?entrar=1");
  if (!user.legalAccepted) redirect("/");
  const access = await getAdministratorAccess(user);
  if (!access.isStaff) notFound();
  if (!hasVerifiedMfa(user)) redirect("/?entrar=1&mfa=1");

  // O portal monta a visão geral uma única vez, com permissões e navegação.
  return <MonitoringPortal administratorName={user.name} permissions={access} />;
}
