import LegalDocument from "../legal-document";
import { SITE_URL } from "@/lib/site";

export const metadata = { title: "Cobrança, Cancelamento e Reembolso", description: "Regras comerciais da CandTech.", alternates: { canonical: `${SITE_URL}/cancelamento` } };
export default function CancellationPage() { return <LegalDocument eyebrow="REGRAS COMERCIAIS" title="Cobrança, cancelamento e reembolso" summary="A cobrança ainda não está ativa. Antes da primeira cobrança, a oferta informará preço, periodicidade, recursos, limites, teste gratuito quando houver e meio de cancelamento.">
  <h2>Contratação</h2><p>Nenhuma cobrança será iniciada apenas pela criação de conta. Quando ativada, a contratação exigirá ação afirmativa no ambiente seguro do provedor e confirmação clara do valor e recorrência. Descontos ou períodos promocionais terão duração e condições informadas.</p>
  <h2>Stripe</h2><p>A CandTech poderá usar a Stripe para checkout e assinaturas. Dados completos de cartão serão fornecidos diretamente ao provedor; a CandTech receberá apenas identificadores, status, valor e informações necessárias à conciliação e suporte.</p>
  <h2>Renovação e cancelamento</h2><p>Planos recorrentes renovam na periodicidade informada até o cancelamento. O cancelamento impede novas renovações e, salvo obrigação legal, fraude ou regra mais favorável da oferta, o acesso permanece até o fim do período já pago.</p>
  <h2>Arrependimento e reembolso</h2><p>Direitos obrigatórios permanecem preservados, inclusive o direito de arrependimento quando aplicável à contratação à distância nos termos do Código de Defesa do Consumidor. Cobranças duplicadas, não reconhecidas ou falhas devem ser comunicadas para investigação; reembolsos seguirão a lei, a oferta e o meio de pagamento.</p>
  <h2>Inadimplência</h2><p>Falha de pagamento pode gerar aviso, nova tentativa e suspensão proporcional. Dados não serão apagados imediatamente por inadimplência; será oferecida oportunidade razoável de regularização ou exportação, observados segurança e retenções legais.</p>
</LegalDocument>; }
