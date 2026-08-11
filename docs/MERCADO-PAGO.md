# Preparação segura do Mercado Pago

## Decisão

A conta existente do Mercado Pago pode ser usada. Para um primeiro piloto, um **plano de assinatura com link hospedado** é a opção mais simples e não exige que a CandTech receba cartão ou senha bancária. Para liberar e bloquear automaticamente o ERP, será necessária uma integração de assinaturas no servidor com notificações verificadas.

## Credenciais

- Crie uma aplicação no painel de desenvolvedores e use credenciais de **teste** no Preview.
- Configure `MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_WEBHOOK_SECRET` e `MERCADO_PAGO_PLAN_ID` como variáveis **Sensitive** na Vercel.
- Use valores diferentes em Preview e Production.
- Nunca coloque Access Token, Client Secret ou segredo de webhook em `NEXT_PUBLIC_*`, GitHub, navegador, URL, print, chat ou log.
- A Public Key só pode ficar no navegador quando um SDK de checkout realmente exigir. O checkout hospedado não precisa dela no código da CandTech.
- Em caso de exposição, revogue e gere novas credenciais imediatamente.

## Fluxo comercial correto

1. A página apresenta preço, periodicidade, recursos, limites, cancelamento e reembolso.
2. O servidor cria ou seleciona a assinatura e redireciona ao checkout hospedado.
3. O retorno do navegador é apenas informativo e **não libera acesso**.
4. Uma notificação do Mercado Pago chega ao servidor; para assinaturas, a URL de notificação deve ser informada na criação da assinatura conforme a documentação do produto.
5. O servidor valida autenticidade, consulta o recurso na API com o Access Token e confere cliente, plano, valor, moeda e status.
6. O evento é processado uma única vez por identificador idempotente; só então o status local é atualizado.
7. Cancelamentos, estornos, atrasos e contestações também alteram o acesso segundo a política comercial.

## Antes de ativar produção

- definir preço, periodicidade, teste gratuito e plano;
- definir regra de acesso durante atraso e fim do período pago;
- concluir testes de pagamento aprovado, recusado, duplicado, cancelado, estornado e webhook repetido;
- registrar aceite da oferta e versões dos termos;
- conferir razão social ou nome do recebedor exibido no checkout;
- revisar tributação e emissão de documento com contador;
- testar reembolso e atendimento antes do primeiro anúncio.

## Referências oficiais

- Credenciais: https://www.mercadopago.com.br/developers/pt/docs/your-integrations/credentials
- Segurança de credenciais: https://www.mercadopago.com.br/developers/pt/docs/yampi/best-practices/credentials-best-practices/secure-credentials
- Webhooks: https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
- Planos de assinatura: https://www.mercadopago.com.br/developers/pt/docs/subscription-plans/overview
