# Operação da assinatura por Pix

## Regra comercial

- primeira cobrança: R$ 180, sendo R$ 120 de implantação e R$ 60 do primeiro mês;
- renovação: R$ 60 por 30 dias;
- prazo padrão do Pix: 72 horas;
- gerar o código, enviar o comprovante ou falar no WhatsApp não ativa a assinatura;
- somente um administrador autorizado, após conferir o recebimento na conta, pode aprovar;
- aprovação exige uma cobrança em `payment_review` com comprovante ativo.

## Estados

| Estado | Significado | Acesso liberado? |
| --- | --- | --- |
| `pending` | Pix gerado, comprovante ainda não recebido | Não |
| `payment_review` | Comprovante recebido e aguardando conferência humana | Não |
| `approved` | Recebimento conferido e aprovado pelo administrador | Sim, por 30 dias |
| `rejected` | Comprovante ou pagamento rejeitado | Não |
| `expired` | Prazo do Pix encerrado antes da revisão | Não |

## Jornada do cliente

1. O proprietário autenticado abre `/assinar` e confirma o contato.
2. `POST /api/pix` gera o Pix Copia e Cola com valor e identificador exclusivos.
3. O cliente paga no aplicativo bancário e escolhe PDF, JPG, PNG ou WEBP de até 5 MB.
4. Em produção, o navegador pede uma autorização curta em `/api/pix/[paymentId]/receipt` e envia diretamente ao Vercel Blob privado. Isso evita o limite de 4,5 MB das Functions sem revelar o token do armazenamento.
5. O callback assinado baixa o arquivo de forma privada, confere proprietário, cobrança, validade, tamanho, extensão, MIME e assinatura binária; calcula SHA-256 e grava somente os metadados no banco.
6. O estado muda para `payment_review`. Substituições desativam o registro anterior e removem o objeto antigo quando possível.
7. O envio registra `pix.receipt_uploaded` ou `pix.receipt_replaced`. Ele nunca ativa o plano.

No desenvolvimento local, a mesma rota aceita o corpo binário e guarda o arquivo em `data/pix-receipts/`, diretório ignorado pelo Git. Esse fallback não deve ser usado como armazenamento de produção.

## Jornada administrativa

1. Uma conta verificada com permissão **Cobrança** abre a central privada; somente `ADMIN_EMAILS` concede ou revoga essa permissão.
2. A aba **Pagamentos Pix** prioriza itens em conferência e mostra empresa, usuário e metadados do arquivo.
3. **Visualizar** abre o arquivo por `/api/admin/payments/[paymentId]/receipt`; **Baixar** usa a mesma rota com `?download=1`.
4. A rota exige sessão administrativa, aplica rate limit, impede cache compartilhado, usa `nosniff` e registra `pix.receipt_viewed`.
5. O administrador compara valor, referência e favorecido com o extrato bancário. O comprovante sozinho não prova liquidação.
6. Somente depois dessa conferência seleciona **Aprovar** ou **Rejeitar**.

## Armazenamento e banco

- o Blob deve ser criado com acesso **Private** e conectado ao projeto Vercel;
- o banco guarda nome original normalizado, MIME, tamanho, SHA-256, chave privada, autor, organização, data e estado ativo;
- a chave privada nunca aparece na resposta entregue ao cliente ou na listagem administrativa;
- cada pagamento possui no máximo um comprovante ativo;
- aplique `migrations/20260826_pix_payment_receipts.sql` no Neon antes do deploy;
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
7. confirme que upload não libera acesso e que aprovação sem comprovante falha;
8. abra e baixe pela central, conferindo os eventos de auditoria;
9. teste rejeição, expiração e o backup por e-mail;
10. repita o fluxo em Production com uma conta controlada antes da primeira venda.

## Retenção e limite operacional

A confirmação continua humana: não há consulta bancária automática. O responsável pelo produto ainda precisa definir, com revisão jurídica/LGPD, por quanto tempo comprovantes aprovados e rejeitados serão mantidos e qual rotina excluirá objetos antigos. Até essa política existir, isso permanece item bloqueador do checklist comercial, embora não permita acesso público aos arquivos.
