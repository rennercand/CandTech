# Relatório técnico do OWASP ZAP — 23/08/2026

## Escopo

- Branch: `anterior`.
- Alvo autorizado: `https://finance-app-git-anterior-faguedes.vercel.app`.
- Produção (`candtech.com.br`) não faz parte desta execução.
- Evidências recebidas: varredura passiva, histórico CSV e início de varredura ativa.

## Achados e tratamento

| Alerta do ZAP | Análise | Tratamento |
| --- | --- | --- |
| `CSP: script-src unsafe-inline` | Real, risco médio de ampliar o impacto de uma futura injeção. | CSP passou a usar nonce imprevisível por resposta e `strict-dynamic`; `unsafe-inline` foi removido de `script-src`. |
| `CSP: style-src unsafe-inline` | Real. A política aceitava qualquer bloco de estilo inline. | `style-src` passou a exigir origem própria ou nonce. Apenas atributos de estilo numéricos usados nos gráficos permanecem em `style-src-attr`, sem liberar scripts. |
| `Content Security Policy Header Not Set` | As evidências apontavam para `https://vercel.com/home`, fora do domínio CandTech. | Fora de escopo. As páginas da CandTech enviam CSP com nonce. |
| `Missing Anti-clickjacking Header` | As evidências apontavam para `https://vercel.com/home`. | Fora de escopo. A CandTech envia `X-Frame-Options: DENY` e `frame-ancestors 'none'`. |
| `Configuração Incorreta Entre Domínios` | Ocorreu em `/_next/static/...`, arquivo JavaScript público e sem dados de usuário. | Aceito para recurso público da CDN. APIs autenticadas não configuram `Access-Control-Allow-Origin: *`. |
| `Cookie Without Secure Flag` / `SameSite` | A remoção da sessão no logout não repetia todos os atributos do cookie original. | Logout agora envia `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, expiração e `Max-Age=0`. |
| `Strict-Transport-Security Header Not Set` | Não reproduzido no domínio próprio; pode apontar para resposta externa/sistêmica. | Verificação HTTP confirmou HSTS de dois anos, subdomínios e preload na CandTech. |
| `X-Content-Type-Options Header Missing` | Não reproduzido no domínio próprio. | Verificação HTTP confirmou `nosniff`. |
| `Information Disclosure - Browser localStorage` | O armazenamento contém apenas consentimento do Analytics e um sinal temporário de retorno do Drive. | Aceito; sessão, JWT, senha e tokens OAuth não são armazenados no navegador. |
| `Retrieved from Cache` / `Re-examine Cache-control` | Informativo para recursos estáticos; páginas privadas e APIs exigem tratamento distinto. | APIs e central administrativa usam `private, no-store, max-age=0`. Assets imutáveis podem usar cache. |
| `Session Management Response Identified` | Identificação informativa de resposta de sessão, sem exploração demonstrada. | Sessão permanece em cookie HttpOnly, revogável no servidor e com oito horas de validade. |
| `User Controllable HTML Element Attribute (Potential XSS)` | Baixa confiança; parâmetros `cadastro` e `entrar` somente ativam estados quando iguais a `1` e não são renderizados como HTML. | CSP com nonce reduz impacto; React continua escapando conteúdo e não há uso de HTML não confiável. Deve ser retestado após o deploy da preview. |
| `Travessia/Passagem de Caminho` em `organizationName` | Falso positivo provável: o campo era salvo como JSON e refletido, sem qualquer API de arquivos ou construção de caminho. | Campo agora rejeita sintaxe de travessia/caminho e caracteres de controle. Respostas de gravação não devolvem mais o payload completo. |
| `Injeção SQL` em `rate` no `PUT /api/workspace` | O banco usa consultas parametrizadas e o payload nunca é concatenado ao SQL. O ZAP comparou respostas diferentes de uma rota de autosave: cada tentativa alterava revisão e horário, produzindo um falso sinal booleano. Ainda assim, havia uma validação insuficiente porque `rate`, um campo numérico, aceitava texto arbitrário. | A API passou a aceitar em qualquer campo `rate` somente número finito, número decimal em texto ou rascunho vazio, rejeitando exatamente `' OR '1'='1'--`. A resposta do autosave agora é constante (`{ "saved": true }`) e não expõe revisão, data nem conteúdo enviado. |
| `User Agent Fuzzer (Systemic)` | Nome da regra usada pelo scanner, não uma vulnerabilidade isolada. Só exige correção se uma ocorrência demonstrar erro, vazamento ou comportamento inseguro da aplicação. | Manter sob observação no reteste e avaliar a requisição/resposta concreta caso o ZAP gere um alerta associado. |
| `Divulgação de Data e Hora - Unix` / cabeçalhos do servidor | Metadados de infraestrutura da plataforma, sem segredo da aplicação. | `X-Powered-By` foi removido. Cabeçalhos gerenciados exclusivamente pela Vercel devem ser avaliados como informativos. |

## Evidências automatizadas

- 74 testes automatizados aprovados, incluindo rejeição do payload SQL exibido pelo ZAP no campo `rate`.
- Build de produção Next.js aprovado.
- Página inicial respondeu HTTP 200 em execução de produção local.
- CSP real contém nonce no cabeçalho e no HTML.
- `script-src` e `style-src` não contêm `unsafe-inline`.
- HSTS, `DENY`, `nosniff` e política de cache confirmados na resposta HTTP.
- `X-Powered-By` ausente.
- Navegador headless: página com conteúdo, sem overlay de erro e layout preservado.

## Validação pendente

1. Publicar esta revisão somente na preview da branch `anterior`.
2. Repetir o Spider e a varredura passiva do ZAP com sessão nova.
3. Executar varredura ativa apenas contra banco de testes isolado.
4. Confirmar visualmente o consentimento e o carregamento do Google Analytics após aceitar cookies.
5. Só promover à produção depois de revisar qualquer alerta alto novo e testar restauração de backup.
