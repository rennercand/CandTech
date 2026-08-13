import LegalDocument from "../legal-document";
import { SITE_URL } from "@/lib/site";

export const metadata = { title: "Cobrança, Cancelamento e Reembolso", description: "Regras comerciais da CandTech.", alternates: { canonical: `${SITE_URL}/cancelamento` } };

export default function CancellationPage() { return <LegalDocument eyebrow="REGRAS COMERCIAIS" title="Cobrança, cancelamento e reembolso" summary="A CandTech recebe pagamentos exclusivamente por Pix, com conferência manual antes da liberação do acesso.">
  <h2>Contratação</h2><p>Criar uma conta ou gerar um código Pix não produz cobrança automática nem libera o ERP. A tela informa o valor, a referência e o prazo; a assinatura é ativada somente depois da conferência do recebimento.</p>
  <h2>Pagamento por Pix</h2><p>O pagamento é iniciado no aplicativo bancário escolhido pelo cliente. A CandTech armazena somente referência, valor, prazo e estado da conferência, sem receber senha bancária ou credenciais da conta.</p>
  <h2>Renovação e cancelamento</h2><p>Não existe débito automático. Cada período exige um novo Pix. O cliente pode deixar de renovar; o acesso permanece até o fim do período pago e depois é suspenso.</p>
  <h2>Arrependimento e reembolso</h2><p>Direitos obrigatórios permanecem preservados, inclusive o direito de arrependimento quando aplicável à contratação à distância nos termos do Código de Defesa do Consumidor. Cobranças duplicadas, não reconhecidas ou falhas devem ser comunicadas para investigação; reembolsos seguirão a lei, a oferta e o meio de pagamento.</p>
  <h2>Pix não confirmado</h2><p>Se o pagamento não for confirmado até o prazo informado, a solicitação expira e o acesso é suspenso. Um backup dos dados empresariais disponíveis é enviado ao e-mail verificado do titular, sem impedir posterior regularização e respeitando retenções legais.</p>
</LegalDocument>; }
