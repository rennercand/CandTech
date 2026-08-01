import "./globals.css";

export const metadata = {
  title: "CandTech | Gestão financeira",
  description: "Calculadoras financeiras, fluxo de caixa e histórico por conta.",
};

export default function RootLayout({ children }) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
