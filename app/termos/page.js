import LegalDocument from "../legal-document";
import { TERMS_VERSION } from "@/lib/legal";
import { SITE_URL } from "@/lib/site";

export const metadata = { title: "Termos de Uso", description: "Regras de contratação e uso da CandTech.", alternates: { canonical: `${SITE_URL}/termos` } };

export default function TermsPage() {
  return <LegalDocument eyebrow="CONTRATO" title="Termos de Uso" version={TERMS_VERSION} summary="Ao criar uma conta, a pessoa declara ter 18 anos ou mais, possuir capacidade para contratar e aceitar estes Termos e o Aviso de Privacidade. Se agir por uma empresa, declara ter autorização para vinculá-la.">
    <h2>1. Serviço e escopo</h2>
    <p>A CandTech oferece ferramentas de apoio à gestão financeira, estoque, pedidos, equipe, relatórios e exportações. Recursos, limites, preço e disponibilidade válidos são os exibidos na oferta no momento da contratação.</p>
    <p>Pré-notas e relatórios são documentos comerciais de conferência, sem validade fiscal. A CandTech não emite NF-e, NFC-e, DANFE ou escrituração oficial enquanto isso não estiver expressamente indicado no produto.</p>
    <h2>2. Conta e segurança</h2>
    <p>A pessoa usuária deve fornecer informações verdadeiras, proteger senha e dispositivos, manter o e-mail acessível e comunicar uso indevido. Contas são individuais; colaboradores devem usar seus próprios acessos e as permissões atribuídas pelo proprietário.</p>
    <h2>3. Dados e responsabilidades</h2>
    <p>O cliente conserva a titularidade do conteúdo inserido e concede à CandTech licença limitada para hospedá-lo, processá-lo, protegê-lo, exportá-lo e exibi-lo somente para executar o serviço. O cliente é responsável pela exatidão, legalidade, base legal e minimização dos dados de clientes, empregados e fornecedores que inserir.</p>
    <p>Não insira CPF, dados sensíveis, senhas, números completos de cartão ou outros dados desnecessários. A CandTech não solicita CPF no cadastro comum. CNPJ empresarial é opcional quando necessário para identificação comercial.</p>
    <h2>4. Cálculos e decisões</h2>
    <p>Resultados são apoio gerencial e dependem dos valores informados. Não substituem contabilidade, assessoria jurídica, fiscal ou financeira. Antes de pagar, declarar impostos, precificar ou assumir obrigações, o cliente deve revisar os dados e consultar profissional quando necessário.</p>
    <h2>5. Disponibilidade e alterações</h2>
    <p>Podem ocorrer manutenções, falhas de provedores ou mudanças necessárias à segurança. A CandTech buscará restaurar o serviço e avisar sobre alterações materiais. Mudanças que afetem direitos ou finalidades poderão exigir novo aceite; a versão aplicável ficará identificada.</p>
    <h2>6. Suspensão e encerramento</h2>
    <p>Acesso pode ser limitado para conter incidente, fraude, risco técnico, inadimplência após aviso ou violação material. Sempre que seguro e legalmente possível, haverá informação e oportunidade de correção. O cliente pode cancelar conforme a Política de Cobrança e deve exportar dados antes do término.</p>
    <h2>7. Propriedade intelectual</h2>
    <p>Software, marca, interface e materiais da CandTech permanecem de seus titulares. Não é permitido copiar o serviço, contornar limites, extrair código, revender acesso sem autorização ou realizar testes ofensivos fora de autorização escrita.</p>
    <h2>8. Limites legais</h2>
    <p>Nada nestes Termos exclui responsabilidade por dolo, culpa grave, violação de direitos indisponíveis, proteção de dados ou hipóteses em que a lei proíba limitação. Eventual responsabilidade será apurada conforme a lei, o dano comprovado e a participação de cada parte.</p>
    <h2>9. Lei e solução de conflitos</h2>
    <p>Aplica-se a legislação brasileira. As partes buscarão solução pelo canal de contato antes de litigar. Fica preservado o foro legalmente competente do consumidor quando aplicável; nenhuma cláusula impõe renúncia a direito obrigatório.</p>
  </LegalDocument>;
}
