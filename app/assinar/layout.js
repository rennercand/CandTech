import { SITE_URL } from "@/lib/site";

export const metadata = {
  title: "Planos para organizar seu negócio",
  description: "Conheça os espaços da CandTech para organizar financeiro, estoque, vendas, documentos e equipe sem ativar cobranças antes da contratação.",
  alternates: { canonical: `${SITE_URL}/assinar` },
};

export default function SubscribeLayout({ children }) {
  return children;
}
