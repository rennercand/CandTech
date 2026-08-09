import "./globals.css";
import AnalyticsConsent from "./analytics-consent";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://finance-app-indol-alpha.vercel.app";

export const metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "CandTech | Gestão financeira para pequenos negócios", template: "%s | CandTech" },
  description: "Organize financeiro, estoque, vendas, compras, documentos e cálculos da sua empresa em um único espaço.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "CandTech | Gestão financeira para pequenos negócios",
    description: "Financeiro, estoque, pedidos, documentos e relatórios em um único espaço.",
    url: "/",
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
