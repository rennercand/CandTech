# Auditoria de segredos e dados públicos — 29/08/2026

## Resultado

Nenhuma chave privada, senha, token de API, URL PostgreSQL com credenciais ou chave de provedor foi encontrada nos commits e refs públicas examinadas. O GitHub Secret Scanning também não possuía alertas abertos ou encerrados para o repositório no momento da consulta.

## Escopo examinado

- repositório público `rennercand/CandTech`;
- 114 commits alcançáveis por `main`, `test`, branches antigas, duas refs de pull request e duas tags;
- 113 commits efetivamente processados pelo Gitleaks 8.30.0, com configuração padrão e conteúdo redigido;
- nomes e versões históricas de arquivos sensíveis;
- `.env.example` em todas as 18 versões encontradas;
- padrões conhecidos de tokens, chaves privadas, JWTs e URLs PostgreSQL autenticadas;
- GitHub Secret Scanning via API;
- arquivos rastreados no código atual e artefatos locais ignorados.

## Achados sem credencial

- `.env.example` foi o único arquivo de ambiente já rastreado; os campos sensíveis permaneceram vazios ou com exemplos reconhecíveis;
- o ID público do Google Analytics e endereços de suporte/remetente aparecem por finalidade operacional e não são segredos;
- nome, localidade e contato do responsável publicados em `lib/legal.js` são dados pessoais intencionalmente públicos para transparência jurídica;
- o e-mail configurado como identidade de autor dos commits aparece nos metadados Git de todo o histórico público;
- dez alertas heurísticos no diretório local vieram de `.next/` ignorado e de exemplos no README; nenhum desses arquivos gerados está rastreado, e a varredura do histórico retornou zero vazamentos.

## Recomendações

- usar o endereço `noreply` do GitHub nos próximos commits se não quiser publicar o e-mail pessoal do autor;
- preferir e-mail corporativo para contato jurídico e suporte quando estiver disponível;
- manter Secret Scanning e push protection ativos no GitHub;
- executar Gitleaks no CI e antes de cada push;
- se uma credencial real for encontrada no futuro, revogá-la primeiro e somente depois limpar o histórico, pois apagar o texto do Git não invalida o segredo.

## Limites

Esta revisão não tentou usar credenciais, não leu valores protegidos da Vercel e não cobre conteúdo privado do Neon, logs antigos de provedores, forks de terceiros ou artefatos já baixados por outras pessoas.
