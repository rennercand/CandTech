# Plano de resposta a incidentes — CandTech

Versão inicial: 29/08/2026. Estado: procedimento definido; exercício real ainda pendente.

## Objetivos e responsáveis

- **Responsável técnico:** proprietário da CandTech ou pessoa formalmente designada no registro do exercício.
- **Privacidade/LGPD:** encarregado ou canal de privacidade publicado pela CandTech.
- **Atendimento:** pessoa com permissão `canSupport`, sem acesso automático a cobrança ou infraestrutura.
- **Cobrança:** pessoa com permissão `canBilling`, acionada apenas quando o incidente envolver pagamentos.
- **Decisão de comunicação externa:** controlador dos dados, com apoio jurídico quando houver dados pessoais.

Os nomes, telefones alternativos e substitutos devem ficar em um registro operacional privado, nunca neste repositório público.

## Classificação

| Nível | Exemplo | Primeira ação | Meta interna inicial |
| --- | --- | --- | --- |
| P0 | segredo exposto, acesso entre empresas, perda ou alteração ampla de dados | conter, preservar evidências e suspender o fluxo afetado | 30 minutos |
| P1 | autenticação, cobrança ou exportação comprometida sem evidência de alcance amplo | bloquear a função, revogar acessos e investigar | 2 horas |
| P2 | indisponibilidade parcial ou erro com alternativa operacional | mitigar, comunicar usuários afetados e corrigir | 8 horas |
| P3 | falha pequena sem impacto em segurança ou dados | registrar e planejar correção | próximo ciclo |

## Fluxo obrigatório

1. Registrar horário, origem do alerta, ambiente, sistemas afetados e responsável atual.
2. Preservar logs e evidências sem copiar senhas, tokens, comprovantes ou dados completos para tickets.
3. Conter o incidente: revogar sessão/segredo, pausar integração, limitar rota ou reverter deploy conforme o caso.
4. Identificar empresas e titulares potencialmente afetados usando a trilha de auditoria; não ampliar o acesso da equipe por conveniência.
5. Erradicar a causa, rotacionar credenciais relacionadas e validar o ajuste em ambiente isolado.
6. Recuperar a partir de versão ou backup conhecido, acompanhar erros e confirmar integridade.
7. Avaliar, com o controlador e apoio jurídico, obrigações de comunicação à ANPD e aos titulares.
8. Registrar causa raiz, linha do tempo, impacto, decisão de comunicação e ações preventivas.

## Cenários rápidos

### Segredo publicado

Revogar ou rotacionar primeiro, identificar usos indevidos, atualizar apenas variáveis protegidas e então limpar o histórico se necessário. Apagar o texto do Git não invalida o segredo.

### Suspeita de acesso entre empresas

Suspender a rota afetada, preservar consultas e eventos, executar testes com duas organizações, identificar registros lidos ou alterados e comunicar a decisão antes de reabrir.

### Perda ou corrupção de dados

Interromper gravações no conjunto afetado, preservar o estado atual, escolher o ponto de recuperação, restaurar primeiro em ambiente isolado e comparar contagens, vínculos e hashes antes da promoção.

## Exercício trimestral

O exercício deve usar Preview e banco/Blob isolados, nunca dados reais. O registro deve conter data, cenário, participantes, tempo de detecção, tempo de contenção, tempo de restauração, divergências e responsáveis pelas correções. O exercício só passa quando nenhuma credencial aparece na evidência, a restauração é verificável e as metas assumidas são atingidas.

Modelo de evidência:

```text
Data e cenário:
Participantes e papéis:
Ambiente isolado:
Detectado em:
Contido em:
Restaurado em:
RPO/RTO observado:
Dados de teste conferidos:
Falhas encontradas:
Ações, responsáveis e prazos:
```
