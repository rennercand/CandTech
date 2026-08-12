import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { isAdministrator } from "@/lib/admin-access";
import MonitoringPortal from "./portal";

export const metadata = {
  title: "Monitoramento privado",
  robots: { index: false, follow: false, nocache: true },
};

export default async function MonitoringPage() {
  const cookieStore = await cookies();
  const user = await getSession({ cookies: cookieStore }, { allowInactiveSubscription: true });
  if (!user) redirect("/?entrar=1");
  if (!isAdministrator(user.email)) notFound();
  return <MonitoringPortal administratorName={user.name} />;
}
