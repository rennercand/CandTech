import { SITE_URL } from "@/lib/site";

export default function sitemap() {
  const legalPages = ["juridico", "termos", "propriedade-intelectual", "privacidade", "cookies", "uso-aceitavel", "tratamento-de-dados", "cancelamento", "seguranca"];
  return [
    { url: SITE_URL, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/assinar`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/mapa-do-sistema`, changeFrequency: "monthly", priority: 0.6 },
    ...legalPages.map((page) => ({ url: `${SITE_URL}/${page}`, changeFrequency: "yearly", priority: 0.3 })),
  ];
}
