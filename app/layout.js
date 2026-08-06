import "./globals.css";

export const metadata = {
  title: "CandTech | Gestão financeira",
  description: "Calculadoras financeiras, fluxo de caixa e histórico por conta.",
};

// Usa toda a largura do aparelho e respeita as áreas seguras de celulares.
export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
