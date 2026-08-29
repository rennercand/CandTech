# Operação da assinatura por Pix

## Regra comercial

- primeira cobrança: R$ 180, sendo R$ 120 de implantação e R$ 60 do primeiro mês;
- ao aprovar essa primeira cobrança, `billing_profiles.setup_paid_at` registra permanentemente a implantação na conta;
- cobranças seguintes são de R$ 60, inclusive após vencimento, suspensão ou arquivamento do histórico de pagamentos;
- renovação: R$ 60 por 30 dias;
- prazo padrão do Pix: 72 horas;
- gerar o código, enviar o comprovante ou falar no WhatsApp não ativa a assinatura;
- somente um administrador autorizado, após conferir o recebimento na conta, pode aprovar;
- o comprovante é opcional: o administrador pode aprovar uma cobrança `pending` ou `payment_review` depois de localizar o recebimento no banco.

## Estados

| Estado | Significado | Acesso liberado? |
| --- | --- | --- |
| `pending` | Pix gerado, comprovante ainda não recebido | Não |
| `payment_review` | Comprovante recebido e aguardando conferência humana | Não |
| `approved` | Recebimento conferido e aprovado pelo administrador | Sim, por 30 dias |
| `rejected` | Comprovante ou pagamento rejeitado | Não |
| `expired` | Prazo do Pix encerrado antes da revisão | Não |

## Jornada do cliente

1. O proprietário autenticado abre `/assinar`; a cobrança usa somente o nome e o e-mail já cadastrados na conta.
2. `POST /api/pix` gera o Pix Copia e Cola com valor e identificador exclusivos.
3. O cliente paga no aplicativo bancário e, se quiser facilitar a conferência, escolhe PDF, JPG, PNG ou WEBP de até 5 MB.
4. Em produção, o navegador pede uma autorização curta em `/api/pix/[paymentId]/receipt` e envia diretamente ao Vercel Blob privado. Isso evita o limite de 4,5 MB das Functions sem revelar o token do armazenamento.
5. O callback assinado baixa o arquivo de forma privada, confere proprietário, cobrança, validade, tamanho, extensão, MIME e assinatura binária; calcula SHA-256 e grava somente os metadados no banco.
6. O estado muda para `payment_review`. Substituições desativam o registro anterior e removem o objeto antigo quando possível.
7. O envio registra `pix.receipt_uploaded` ou `pix.receipt_replaced`. Ele nunca ativa o plano.

No desenvolvimento local, a mesma rota aceita o corpo binário e guarda o arquivo em `data/pix-receipts/`, diretório ignorado pelo Git. Esse fallback não deve ser usado como armazenamento de produção.

## Estrutura EMV do QR Code

O QR Code contém exatamente o mesmo texto do Pix Copia e Cola. `lib/pix.js` monta e autodecodifica os campos antes de responder:

| Caminho EMV | Conteúdo |
| --- | --- |
| `00` | versão do payload (`01`) |
| `26.00` | GUI `BR.GOV.BCB.PIX` |
| `26.01` | chave Pix cadastrada no DICT |
| `26.02` | descrição opcional, removida se não houver espaço no limite do template |
| `54` | valor com duas casas decimais |
| `58` | país `BR` |
| `59` / `60` | nome e cidade do favorecido |
| `62.05` | TXID da solicitação |
| `63` | CRC16-CCITT do payload |

A chave não aparece com a palavra literal `DICT`: decodificadores BR Code devem apresentá-la como o subcampo `01` dentro do template `26`. Se `26.01` estiver ausente, diferente de `PIX_KEY`, com TLV inválido ou CRC incorreto, o servidor rejeita a geração com `PIX_EMV_INVALID` e não entrega o QR ao navegador.

Antes de montar o TLV, o servidor remove aspas externas, espaços invisíveis e formatação comum copiada junto com a chave. E-mails são convertidos para minúsculas, telefones brasileiros formatados recebem o padrão `+55`, CPF/CNPJ ficam somente com dígitos e EVP permanece em UUID. Essa normalização não cria nem troca a chave: ela apenas produz o formato canônico esperado pelo DICT.

## Jornada administrativa

1. Uma conta verificada com permissão **Cobrança** abre a central privada; somente `ADMIN_EMAILS` concede ou revoga essa permissão.
2. A aba **Pagamentos Pix** prioriza itens em conferência e mostra somente nome, e-mail e os dados operacionais da cobrança.
3. **Visualizar** abre o arquivo por `/api/admin/payments/[paymentId]/receipt`; **Baixar** usa a mesma rota com `?download=1`.
4. A rota exige sessão administrativa, aplica rate limit, impede cache compartilhado, usa `nosniff` e registra `pix.receipt_viewed`.
5. O administrador compara valor, referência e favorecido com o extrato bancário. O comprovante sozinho não prova liquidação.
6. Somente depois dessa conferência seleciona **Aprovar** ou **Rejeitar**.

## Armazenamento e banco

- o Blob deve ser criado com acesso **Private** e conectado ao projeto Vercel;
- nome e e-mail permanecem uma única vez em `users`; cobranças guardam apenas a referência `user_id` e não duplicam essa identificação;
- o e-mail é normalizado e limitado a 254 caracteres. No PostgreSQL, `TEXT` e `VARCHAR` usam a mesma representação variável, portanto trocar o tipo não reduziria o espaço ocupado;
- o banco guarda nome original normalizado, MIME, tamanho, SHA-256, chave privada de armazenamento, autor, organização, data e estado ativo;
- a chave privada de armazenamento nunca aparece na resposta entregue ao cliente ou na listagem administrativa;
- cada pagamento possui no máximo um comprovante ativo;
- aplique `migrations/20260826_pix_payment_receipts.sql` no Neon antes do deploy;
- aplique `migrations/20260828_billing_setup_paid.sql` para registrar a implantação já paga e cobrar somente R$ 60 nas renovações;
- Production e Preview devem usar stores e bancos separados.

## Variáveis obrigatórias

```env
PIX_KEY=
PIX_RECEIVER_NAME=
PIX_RECEIVER_CITY=MAIRINQUE
PIX_MONTHLY_AMOUNT_CENTS=6000
PIX_SETUP_AMOUNT_CENTS=12000
PIX_PAYMENT_TTL_HOURS=72
BLOB_READ_WRITE_TOKEN=
CRON_SECRET=
RESEND_API_KEY=
AUTH_EMAIL_FROM="CandTech <acesso@candtech.com.br>"
BILLING_ENFORCEMENT_ENABLED=false
```

`PIX_KEY` e `BLOB_READ_WRITE_TOKEN` são segredos de servidor e nunca usam `NEXT_PUBLIC_`. Em deployments Vercel, o SDK também pode usar OIDC e `BLOB_STORE_ID` quando o store está conectado ao projeto.

## Homologação obrigatória

Antes de ativar `BILLING_ENFORCEMENT_ENABLED=true`:

1. aplique a migration no banco de Preview;
2. conecte um Blob privado exclusivo de Preview;
3. envie um arquivo válido de cada formato e um arquivo de exatamente 5 MB;
4. confirme a rejeição de SVG, MIME divergente, magic bytes falsos, nome com caminho e arquivo acima do limite;
5. tente enviar e abrir comprovante com outra conta e confirme `403/404` sem vazamento de existência;
6. substitua um comprovante e confirme apenas um registro ativo;
7. confirme que upload não libera acesso e que a aprovação manual funciona com ou sem comprovante somente após a conferência bancária;
8. abra e baixe pela central, conferindo os eventos de auditoria;
9. teste rejeição, expiração e o backup por e-mail;
10. decodifique o Copia e Cola e confirme GUI `26.00`, DICT `26.01`, TXID `62.05`, valor e CRC;
11. repita o fluxo em Production com uma conta controlada antes da primeira venda.

## Retenção e limite operacional

A confirmação continua humana: não há consulta bancária automática. O responsável pelo produto ainda precisa definir, com revisão jurídica/LGPD, por quanto tempo comprovantes aprovados e rejeitados serão mantidos e qual rotina excluirá objetos antigos. Até essa política existir, isso permanece item bloqueador do checklist comercial, embora não permita acesso público aos arquivos.
