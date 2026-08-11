import LegalDocument from "../legal-document";
import { SITE_URL } from "@/lib/site";

export const metadata = { title: "Segurança", description: "Práticas e canal de segurança da CandTech.", alternates: { canonical: `${SITE_URL}/seguranca` } };
export default function SecurityPage() { return <LegalDocument eyebrow="DEFESA EM CAMADAS" title="Segurança e comunicação de incidentes" summary="A CandTech aplica controles proporcionais ao risco, mas não promete invulnerabilidade. Segurança depende também das senhas, dispositivos, permissões e dados inseridos por cada cliente.">
  <h2>Controles atuais</h2><ul><li>senha com hash forte e confirmação de e-mail;</li><li>sessões curtas em cookie HttpOnly, Secure em produção e SameSite=Lax;</li><li>autorização no servidor e isolamento por organização, sem confiar no ID enviado pelo navegador;</li><li>limites de requisições, validação de entrada, proteção contra CSRF e respostas sem detalhes internos;</li><li>tokens de integração cifrados, segredos somente no servidor e registros de ações relevantes;</li><li>URLs públicas de documentos com identificadores aleatórios e verificação de propriedade.</li></ul>
  <h2>Responsabilidade do cliente</h2><p>Use senha exclusiva, mantenha e-mail e dispositivo protegidos, revogue acessos de ex-colaboradores, aplique o menor privilégio e não compartilhe credenciais. Suspeitas devem ser comunicadas imediatamente.</p>
  <h2>Incidentes</h2><p>A CandTech conterá, investigará, preservará evidências e avaliará risco. Quando houver risco ou dano relevante, comunicará ANPD e titulares no prazo legal aplicável, atualmente de três dias úteis, com as informações disponíveis e atualizações necessárias.</p>
  <h2>Divulgação responsável</h2><p>Envie relato privado com URL, impacto e passos de reprodução. Não acesse dados alheios, não mantenha persistência, não cause indisponibilidade e não publique detalhes antes da correção e autorização.</p>
</LegalDocument>; }
