import LegalDocument from "../legal-document";
import { PRIVACY_VERSION } from "@/lib/legal";
import { SITE_URL } from "@/lib/site";

export const metadata = { title: "Aviso de Privacidade", description: "Como a CandTech trata dados pessoais conforme a LGPD.", alternates: { canonical: `${SITE_URL}/privacidade` } };

export default function PrivacyPage() {
  return <LegalDocument eyebrow="LGPD" title="Aviso de Privacidade" version={PRIVACY_VERSION} summary="Este aviso explica quais dados são tratados, para quais finalidades, com quem podem ser compartilhados e como exercer direitos. A CandTech adota minimização: não solicita CPF no cadastro comum nem armazena dados completos de cartão.">
    <h2>1. Papéis na LGPD</h2>
    <p>A CandTech é controladora dos dados de cadastro, contratação, segurança e relacionamento. Para dados de clientes, colaboradores e fornecedores inseridos pelo comércio no ERP, o comércio normalmente é o controlador e a CandTech atua como operadora, conforme suas instruções e a lei.</p>
    <h2>2. Dados tratados</h2>
    <ul><li>cadastro: nome, e-mail, tipo de conta, hash de senha e confirmação do e-mail;</li><li>contratação: nome ou razão social, contato, endereço, status e identificadores do provedor de pagamento; dados completos de cartão ficam com o provedor;</li><li>uso do ERP: conteúdo financeiro, estoque, pedidos, equipe, relatórios e arquivos inseridos pelo usuário;</li><li>segurança: sessão, IP e informações técnicas necessárias para prevenção de fraude, limitação de abuso, auditoria e incidentes;</li><li>integrações: tokens cifrados do Google Drive quando a conexão é autorizada e eventos do Google Analytics somente após consentimento.</li></ul>
    <h2>3. Finalidades e bases legais</h2>
    <p>Tratamos dados para criar e autenticar contas, cumprir o contrato, salvar e exportar conteúdo, atender solicitações, proteger o serviço, cumprir obrigações legais, exercer direitos e melhorar estabilidade. As bases podem ser execução de contrato e procedimentos preliminares, obrigação legal, exercício regular de direitos, legítimo interesse com avaliação e salvaguardas, e consentimento para análise opcional.</p>
    <h2>4. Compartilhamento</h2>
    <p>Somente o necessário pode ser compartilhado com infraestrutura e banco de dados, envio de e-mail, Google Drive por autorização, Google Analytics por consentimento e Stripe quando a cobrança for ativada. Também poderá haver compartilhamento por obrigação legal, ordem válida ou proteção de direitos. Prestadores não recebem autorização para usar dados do ERP para finalidades próprias incompatíveis.</p>
    <h2>5. Transferência internacional</h2>
    <p>Alguns fornecedores podem processar dados fora do Brasil. A CandTech selecionará serviços com medidas contratuais e técnicas compatíveis e observará os mecanismos previstos na LGPD e pela ANPD.</p>
    <h2>6. Retenção e eliminação</h2>
    <p>Dados permanecem enquanto a conta estiver ativa e pelo período necessário à prestação, defesa de direitos, prevenção de fraude e obrigações legais. Tokens de confirmação expiram em 24 horas, redefinição em 30 minutos e sessões normais em 8 horas. Registros de incidentes são mantidos pelo prazo legal aplicável. Após solicitação ou encerramento, dados são eliminados ou anonimizados quando não houver base legítima de retenção; cópias de segurança seguem seu ciclo técnico.</p>
    <h2>7. Direitos</h2>
    <p>O titular pode pedir confirmação, acesso, correção, anonimização, bloqueio, eliminação, portabilidade quando regulamentada, informação sobre compartilhamentos, revisão de decisões automatizadas aplicáveis e revogação do consentimento. A identidade poderá ser verificada com o mínimo de informação necessário. Também é possível peticionar à ANPD.</p>
    <h2>8. Crianças e dados sensíveis</h2>
    <p>O serviço é direcionado a pessoas com 18 anos ou mais e não pretende tratar dados de crianças. Não solicitamos dados pessoais sensíveis para o funcionamento comum. O cliente não deve inserir esses dados sem necessidade, base legal e salvaguardas adequadas.</p>
    <h2>9. Segurança e incidentes</h2>
    <p>São usados autenticação, confirmação de e-mail, segregação por organização, autorização no servidor, criptografia de tokens, senhas com hash, cookies protegidos, limitação de requisições e registros de auditoria. Nenhum sistema é infalível. Incidentes relevantes serão avaliados e comunicados à ANPD e aos titulares nos prazos legais aplicáveis.</p>
  </LegalDocument>;
}
