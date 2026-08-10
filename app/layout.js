import "./globals.css";
import AnalyticsConsent from "./analytics-consent";
import { HOME_DESCRIPTION, SITE_URL } from "@/lib/site";

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

export default function RootLayout({ children }) {
  return <html lang="pt-BR"><body>{children}<AnalyticsConsent /></body></html>;
}
