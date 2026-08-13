# Operação da assinatura por Pix

## Regra comercial

- primeira cobrança: R$ 180, sendo R$ 120 de implantação e R$ 60 do primeiro mês;
- renovação: R$ 60 por 30 dias;
- prazo padrão para confirmação: 72 horas;
- gerar o código ou enviar uma mensagem não ativa a assinatura;
- somente o administrador autorizado, após conferir o recebimento na conta bancária, pode aprovar.

## Jornada do cliente

1. O proprietário autenticado abre `/assinar` e confirma seus dados de contato.
2. O servidor gera um Pix Copia e Cola com valor e identificador exclusivos.
3. A solicitação aparece na central privada e também abre um chamado interno.
4. O cliente pode copiar o código ou abrir o WhatsApp com uma mensagem preenchida. O sistema não envia WhatsApp automaticamente.
5. Depois da conferência bancária, o administrador aprova ou rejeita na aba **Pagamentos Pix**.

## Rejeição, vencimento e backup

Uma rejeição muda a assinatura para `canceled`. Uma solicitação vencida muda para `past_due`. Nos dois casos, o sistema prepara um ZIP em memória com os dados empresariais disponíveis e tenta enviá-lo pelo Resend ao e-mail verificado do proprietário.

O ZIP não contém hash de senha, JWT, sessão, token do Google Drive, chave de API nem credencial bancária. O envio usa chave idempotente para reduzir duplicidade. Se o Resend estiver indisponível, o registro continua pendente e o cron diário tenta novamente.

O anexo por e-mail é uma exportação de saída para o cliente, não substitui backup e restauração da infraestrutura Neon.

## Variáveis obrigatórias

```env
PIX_KEY=
PIX_RECEIVER_NAME=
PIX_RECEIVER_CITY=MAIRINQUE
PIX_MONTHLY_AMOUNT_CENTS=6000
PIX_SETUP_AMOUNT_CENTS=12000
PIX_PAYMENT_TTL_HOURS=72
CRON_SECRET=
RESEND_API_KEY=
AUTH_EMAIL_FROM="CandTech <acesso@candtech.com.br>"
BILLING_ENFORCEMENT_ENABLED=false
```

O nome deve corresponder ao titular real da chave Pix. Não habilite a exigência de assinatura antes de gerar um Pix real, aprovar uma conta de teste controlada, rejeitar outra e confirmar o recebimento e abertura do ZIP.

## Limite atual

A confirmação é humana. Não há integração bancária para consultar liquidação automaticamente e não há API oficial de WhatsApp configurada. Isso evita uma falsa confirmação, mas exige conferência operacional diária.
