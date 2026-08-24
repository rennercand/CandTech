import "./globals.css";
import AnalyticsConsent from "./analytics-consent";
import { HOME_DESCRIPTION, SITE_URL } from "@/lib/site";
import MonitoringClient from "./monitoring-client";
import { connection } from "next/server";
import { headers } from "next/headers";

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "CandTech | Gestão financeira para pequenos negócios", template: "%s | CandTech" },
  description: HOME_DESCRIPTION,
  openGraph: {
    title: "CandTech | Gestão financeira para pequenos negócios",
    description: HOME_DESCRIPTION,
    url: SITE_URL,
    siteName: "CandTech",
    locale: "pt_BR",
    type: "website",
  },
};

// Usa toda a largura do aparelho e respeita as áreas seguras de celulares.
export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }) {
  // A CSP usa um nonce diferente em cada resposta, portanto as páginas precisam
  // ser renderizadas a partir da requisição em vez de reutilizar HTML estático.
  await connection();
  const nonce = (await headers()).get("x-nonce") || undefined;
  return <html lang="pt-BR"><body>{children}<AnalyticsConsent nonce={nonce} /><MonitoringClient /></body></html>;
}
