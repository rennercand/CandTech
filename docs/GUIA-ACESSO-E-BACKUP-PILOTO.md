# Guia de acesso seguro e backup do piloto

## Envio manual pela conta raiz — atualização

Na central privada, abra **Suporte → Backups das contas de clientes**. Selecione o titular e pressione **Enviar backup por e-mail**, conferindo a empresa na confirmação. Contas administrativas e colaboradores não aparecem como destinatários de backups empresariais. O servidor exige conta raiz, MFA, aceite jurídico e e-mail do titular efetivamente verificado; não aceita endereço digitado nem destinatário alternativo.

O ZIP é gerado na hora e enviado como anexo pelo Resend. Não é cifrado, não pode ser revogado depois do envio e não garante sigilo total. A resposta “aceito pelo provedor” não comprova entrega. Há limite de frequência, chave de operação persistida e auditoria prévia sem conteúdo do ZIP. Em falha incerta, confira o provedor antes de iniciar outro envio. Os limites do pacote existente permanecem: até 15 MiB comprimidos e 32 MiB de JSON; anexos e restauração integral continuam fora do escopo.

O download do próprio titular e o aviso automático de expiração permanecem separados deste envio administrativo, que só ocorre após sua confirmação. A visão do sistema mostra nomes/empresas com sessão válida utilizada nos últimos 15 minutos, paginados em grupos de 50; não é presença em tempo real. O contador de workspaces foi renomeado para evitar confundir cadastro com atividade.

### Pendências operacionais ainda não executadas

Nesta sessão, só existe `.env.example` no workspace; não há conector Neon nem ferramentas PostgreSQL/contêiner disponíveis. Não foram acessados dados de produção para testar concorrência, privilégios ou restauração. É necessário disponibilizar um ambiente PostgreSQL isolado por canal seguro e escolher o destino privado do backup completo. A revisão do painel de incidentes não equivale a configurar alertas externos nem a realizar um exercício de incidente. Não contratar ou alterar privilégios de produção automaticamente.

## 1. Baixar o ZIP de um cliente

O proprietário entra na CandTech, confirma o MFA e abre **Exportar meus dados (ZIP)** no menu, ou `/exportar-dados`. O navegador salva o arquivo no dispositivo dele. A API não aceita escolher outra empresa pelo endereço. Funcionários não podem baixar o pacote empresarial completo.

Não há cópia permanente desse ZIP no site nem envio como anexo de e-mail. Após expiração do Pix, o e-mail agora aponta para a página de exportação, sem token de acesso no link. Os campos históricos `backup_sent_at`/`backupsSent` foram mantidos por compatibilidade e passam a indicar o envio do aviso, não a criação de um snapshot.

Conteúdo atual: JSON com identificação, perfil, workspace, histórico e estoque; LEIA-ME explica as limitações. Anexos e outras tabelas não estão incluídos. Não há importador de restauração. O pacote é gerado em memória, não é cifrado e tem limite de download de 4 MiB; volumes maiores exigem atendimento assistido, ainda não automatizado. Não é backup completo nem snapshot transacional.

## 2. Liberar acesso para assistência técnica

O assistente não possui e-mail próprio para convite nem precisa da sua senha. Acesso ocorre pelas ferramentas autenticadas nesta tarefa ou por uma sessão que você abre e autoriza utilizar. Não crie conta administrativa genérica para o assistente.

1. Mantenha GitHub, Vercel e Neon sob contas que você controla, com MFA e recuperação guardada fora do chat.
2. Para código, disponibilize somente o repositório CandTech no workspace e na integração autenticada. Nunca coloque `.env`, dumps ou ZIPs de clientes no GitHub.
3. Para Vercel, use a integração autenticada disponível na tarefa. Para uma operação não coberta, abra o painel e faça você mesmo login/MFA. Informe apenas projeto, ambiente e operação pretendida, não os valores das variáveis.
4. Para Neon, abra o projeto correto na sua conta. Primeiro confira as permissões e ambientes; para teste de restauração, crie um destino isolado vazio. Não reutilize a credencial de runtime da aplicação para administrar o banco.
5. Caso uma operação realmente exija credencial técnica, configure-a diretamente no gerenciador de segredos do ambiente de execução, fora do chat. Use o menor escopo e tempo de vida suportados; confirme o canal antes de criar a chave. Não execute comandos que imprimam variáveis ou a URL de conexão.
6. Ao terminar, revogue acessos temporários e remova os ambientes de teste apenas depois da sua confirmação e de registrar o resultado sem dados pessoais.

Credencial da API do Neon e papel SQL do PostgreSQL são controles diferentes. Limitar um projeto na API não garante que o papel SQL deixe de poder apagar tabelas. O diagnóstico privado da aplicação deve conferir o papel de runtime separadamente.

## 3. O que você precisa escolher para o backup completo

- Destino privado separado da aplicação e, preferencialmente, da conta principal: provedor/conta, região e orçamento. Não é necessário enviar dados de acesso nesta conversa.
- Quem pode recuperar os dados e onde ficará a chave de cifragem, fora do ZIP e do repositório.
- Prazo de retenção e tolerância à perda de dados/interrupção. As metas de 24 horas/8 horas do runbook são provisórias, não um SLA vendido.

Depois dessas escolhas: configurar cópia consistente de PostgreSQL, copiar os objetos privados, cifrar, verificar hashes, automatizar a execução e testar a restauração em destino isolado. Nada disso deve ser considerado ativo somente porque o download do cliente funciona.

## 4. Liberar um cliente após Pix manual

1. Faça o atendimento inicial, explique o escopo do piloto, o valor inicial de R$ 120 e as renovações de R$ 80.
2. O cliente cadastra a própria conta e confirma o e-mail; não peça a senha dele.
3. Na central privada, entre com sua conta administrativa e MFA, localize a cobrança pelo cliente e confira valor/referência.
4. Confirme o recebimento no extrato do banco. Um comprovante ou QR gerado não prova o recebimento.
5. Só então aprove a cobrança na moderação. Confira a ativação no servidor; não desative a exigência de assinatura para liberar apenas uma pessoa.
6. Se não localizar o crédito ou houver divergência, mantenha a cobrança pendente e faça a conferência antes de aprovar.

## 5. O que falta para liberar o piloto

Consulte a [meta do piloto](./META-PILOTO.md). Bloqueios operacionais: backup completo e restauração testada, concorrência no PostgreSQL isolado, conferência do papel sem DDL/configuração privada, entrega real de e-mails, ciclo Pix manual acompanhado e responsáveis/condições comerciais definidos. Fiscal e integrações bancárias automáticas estão fora deste piloto.

## Referências oficiais

- [Permissões por projeto no Neon](https://neon.com/blog/neon-now-has-per-project-permissions)
- [Chaves e organizações no Neon](https://neon.com/docs/manage/orgs-api)
- [Armazenamento privado do Vercel Blob](https://vercel.com/docs/vercel-blob/private-storage)
- [Runbook de restauração da CandTech](./BACKUP-E-RESTAURACAO.md)
