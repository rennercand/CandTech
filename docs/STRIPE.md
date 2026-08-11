# Preparação segura da Stripe

## Arquitetura adotada

- Checkout de assinatura hospedado pela Stripe; a CandTech não recebe dados completos de cartão.
- O navegador recebe apenas a URL temporária do Checkout.
- O retorno para `/assinar?checkout=success` é informativo e nunca libera acesso.
- O status local só é atualizado por webhook com assinatura válida e preço correspondente a `STRIPE_PRICE_ID`.
- O Portal do Cliente permite atualizar pagamento e cancelar a assinatura sem manipular cartão na CandTech.

## Variáveis na Vercel

- `STRIPE_SECRET_KEY`: Sensitive; use `sk_test_` no Preview e `sk_live_` somente em Production.
- `STRIPE_WEBHOOK_SECRET`: Sensitive; cada endpoint/ambiente possui um `whsec_` diferente.
- `STRIPE_PRICE_ID`: identificador `price_` do preço recorrente criado no mesmo ambiente.
- `PUBLIC_APP_URL`: URL de retorno; Preview e Production precisam apontar para seus ambientes corretos.

Nunca use `NEXT_PUBLIC_` para as duas chaves secretas, nunca as envie em chat, print, URL ou GitHub e nunca copie uma chave live para Preview.

## Configuração no Dashboard

1. Crie um produto e um preço recorrente no modo de teste.
2. Ative e configure o Customer Portal, incluindo cancelamento e atualização do meio de pagamento.
3. Crie o webhook `https://SEU-DOMINIO/api/stripe/webhook` e assine somente:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
4. Copie o segredo específico desse endpoint para `STRIPE_WEBHOOK_SECRET`.
5. Teste assinatura aprovada, cancelada, incompleta, atrasada, webhook repetido e assinatura com preço incorreto.
6. Só depois repita a configuração em modo live, com chaves e webhook próprios de Production.

## Controles implementados

- autenticação JWT e limite de requisições para Checkout e Portal;
- preço escolhido apenas no servidor, sem aceitar `priceId` do navegador;
- chave de idempotência na criação da sessão;
- corpo bruto e limite de 1 MB no webhook;
- verificação obrigatória de `Stripe-Signature` com tolerância padrão contra replay;
- deduplicação por `event.id`;
- validação do usuário, assinatura, cliente e preço antes de alterar o banco;
- mensagens públicas genéricas e detalhes técnicos somente no log protegido.

## Referências

- https://docs.stripe.com/payments/checkout/build-subscriptions
- https://docs.stripe.com/webhooks
- https://docs.stripe.com/api/authentication
- https://docs.stripe.com/api/idempotent_requests
