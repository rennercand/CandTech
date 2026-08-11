import LegalDocument from "../legal-document";
import { SITE_URL } from "@/lib/site";

export const metadata = { title: "Política de Uso Aceitável", description: "Condutas permitidas e proibidas na CandTech.", alternates: { canonical: `${SITE_URL}/uso-aceitavel` } };
export default function AcceptableUsePage() { return <LegalDocument eyebrow="PROTEÇÃO DO SERVIÇO" title="Política de Uso Aceitável" summary="O serviço deve ser usado de forma legal, segura e compatível com a gestão do próprio negócio.">
  <h2>É proibido</h2><ul><li>usar a plataforma para fraude, lavagem de dinheiro, discriminação, assédio, violação de direitos ou atividade ilegal;</li><li>inserir malware, explorar vulnerabilidades, automatizar abuso, contornar limites ou interferir em contas e sistemas de terceiros;</li><li>tentar acessar dados por troca de identificadores, elevação de privilégios, credenciais alheias ou engenharia social;</li><li>realizar pentest, varredura ativa ou divulgação pública de falha sem autorização escrita e escopo definido;</li><li>armazenar senhas, dados completos de cartão, dados sensíveis ou documentos pessoais sem necessidade e base legal;</li><li>copiar, revender, sublicenciar ou fazer engenharia reversa do serviço fora das permissões legais.</li></ul>
  <h2>Resposta a abuso</h2><p>A CandTech pode limitar requisições, preservar evidências, revogar sessões e suspender o acesso necessário para conter risco. Medidas serão proporcionais e, quando seguro, acompanhadas de aviso e canal de contestação.</p>
  <h2>Relato responsável</h2><p>Suspeitas de vulnerabilidade devem ser enviadas privadamente ao contato abaixo, com passos mínimos de reprodução e sem acessar, alterar ou publicar dados de terceiros.</p>
</LegalDocument>; }
