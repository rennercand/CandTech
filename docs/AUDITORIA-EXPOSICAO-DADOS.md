# Verificação de exposição de dados

Data de conclusão: 08/09/2026. Base examinada: `2769913` e referências Git disponíveis após `git fetch origin`.

## Evidências

- Gitleaks 8.30.1, obtido do repositório oficial e com SHA-256 conferido contra o arquivo de checksums da mesma release.
- Varredura `git --log-opts=--all --redact=100`: 151 commits examinados pelo scanner, dois alertas.
- Alertas históricos: vetor sintético de TOTP em `test/mfa.test.js` no commit `e1955ab`; UUID de teste de chave Pix em `test/pix-payment.test.js` no commit `4485f18`. A leitura do contexto confirma uso como fixtures de teste. Nenhuma dessas ocorrências demonstra exposição de credencial real.
- Varredura independente do snapshot completo dos arquivos versionados de HEAD: dois alertas, ambos classificados como exemplos/fixtures (configuração ilustrativa no README e UUID de teste Pix). Não confundir esta varredura com a análise apenas do último diff.
- Consulta de alertas de secret scanning do GitHub retornou lista vazia. Isso não é garantia de ausência de segredos.
- Entre caminhos de arquivos potencialmente sensíveis no histórico consultado, apenas `.env.example` foi encontrado; não foram encontrados arquivos `.env` reais, bancos `.sqlite`/`.db`, chaves `.pem`/`.key` ou arquivos de credenciais com os nomes pesquisados.
- No domínio oficial, GET para `/.env`, `/.env.local` e `/.git/config` retornou 404; `/api/workspace`, `/api/history` e `/api/inventory` sem autenticação retornaram 401. Somente verificações pontuais e não destrutivas foram realizadas.

## Dados públicos que merecem decisão do responsável

O código contém contato de suporte (e-mail e telefone) em `lib/support-contact.js` e `.env.example`, além de nome, localidade e e-mail do responsável em `lib/legal.js`. São apresentados como contatos/identificação pública, não senhas. O histórico Git também conserva metadados dos autores. Confirmar se os contatos pessoais devem permanecer como canais comerciais; não foram removidos automaticamente.

O identificador público do Analytics não é uma credencial secreta. O repositório está público, conforme a verificação anterior; licença proprietária e `private` no package.json não restringem acesso ao código.

## Limitações

Não foi encontrada credencial real exposta nos resultados examinados. Isso não comprova inexistência de vazamento: padrões automáticos têm falsos positivos e falsos negativos. A análise não cobre integralmente logs de produção, anexos Blob, todas as respostas autenticadas, bundles publicados, forks, cópias externas, histórico apagado/inacessível ou todos os comentários e anexos do GitHub. Não houve tentativa de usar credenciais encontradas contra serviços externos.

Não foi alterada configuração de scanner para esconder os alertas. Nenhum histórico foi reescrito e nenhuma credencial foi rotacionada. Os relatórios técnicos temporários foram gerados com valores redigidos e permaneceram fora do repositório.

## Continuidade da roadmap

Manter os testes de isolamento e de HTTP no CI; concluir inspeção dos arquivos públicos e dos fluxos autenticados com usuários sintéticos em Preview; verificar credenciais de runtime do banco, concorrência real no PostgreSQL e restauração completa de Neon/Blob. Não marcar esses itens como concluídos com base nesta varredura de código.
