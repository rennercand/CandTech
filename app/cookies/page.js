import LegalDocument from "../legal-document";
import { SITE_URL } from "@/lib/site";

export const metadata = { title: "Política de Cookies", description: "Cookies necessários e analíticos usados pela CandTech.", alternates: { canonical: `${SITE_URL}/cookies` } };
export default function CookiesPage() { return <LegalDocument eyebrow="PREFERÊNCIAS" title="Política de Cookies" summary="Cookies necessários mantêm a conta segura. Cookies analíticos são opcionais, ficam desligados por padrão e só são carregados após uma escolha afirmativa.">
  <h2>Cookies necessários</h2><p><code>finsight_token</code> mantém a sessão autenticada por até 8 horas. É HttpOnly, Secure em produção e SameSite=Lax. Não pode ser desativado durante o uso autenticado porque identifica a sessão com segurança.</p>
  <h2>Análise opcional</h2><p>Google Analytics pode criar cookies <code>_ga</code> e <code>_ga_*</code> para medir páginas, origem e eventos comerciais agregados. Ele só carrega após “Aceitar análise”. A CandTech não envia conteúdo financeiro, nome, e-mail ou documentos nesses eventos.</p>
  <h2>Escolha e revogação</h2><p>A escolha é guardada no armazenamento local do navegador sob a chave <code>candtech_analytics_consent</code>. O botão “Cookies” permite alterar a preferência. Ao recusar, a aplicação deixa de carregar a ferramenta e tenta remover cookies analíticos do domínio.</p>
  <h2>Configuração do navegador</h2><p>O navegador também permite apagar ou bloquear cookies. Bloquear o cookie necessário impede o login. Mudanças de fornecedores ou finalidades exigirão atualização desta política e, quando necessário, novo consentimento.</p>
</LegalDocument>; }
