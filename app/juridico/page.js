import LegalDocument from "../legal-document";
import { LEGAL_LINKS } from "@/lib/legal";
import { SITE_URL } from "@/lib/site";

export const metadata = { title: "Central jurídica", description: "Documentos jurídicos, de privacidade e segurança da CandTech.", alternates: { canonical: `${SITE_URL}/juridico` } };

export default function LegalHub() {
  return <LegalDocument eyebrow="TRANSPARÊNCIA" title="Central jurídica" summary="Reunimos aqui as regras aplicáveis ao uso da CandTech. Nenhuma cláusula elimina direitos que não possam ser afastados por lei.">
    <h2>Documentos disponíveis</h2>
    <ul>{LEGAL_LINKS.slice(1).map(([label, href]) => <li key={href}><a href={href}>{label}</a></li>)}</ul>
    <h2>Antes de contratar</h2>
    <p>Leia os documentos, confira preço, periodicidade, recursos e eventuais limites mostrados na oferta. A contratação somente deverá ocorrer após aceite expresso.</p>
    <h2>Revisão profissional</h2>
    <p>Estes documentos refletem o produto atual e reduzem ambiguidades, mas não constituem parecer jurídico. Mudanças fiscais, de cobrança, de público ou de fornecedores exigem nova revisão e, quando relevante, novo aceite.</p>
  </LegalDocument>;
}
