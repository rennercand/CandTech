# Contribuindo e padrão de commits

## Branches

- `test`: desenvolvimento e preview da Vercel;
- `main`: produção;
- branches temporárias: `agent/descricao-curta` ou `fix/descricao-curta`.

Não reescreva commits que já chegaram à `main`. Alterar mensagens publicadas exige `force push`, dificulta auditoria e pode quebrar automações. Quando uma mensagem antiga for imperfeita, corrija o contexto na documentação ou em um novo commit.

## Mensagens de commit

Formato recomendado:

```text
tipo: resumo curto no imperativo
```

Tipos usados:

- `feat`: nova funcionalidade;
- `fix`: correção de comportamento;
- `security`: endurecimento de segurança;
- `docs`: documentação;
- `test`: testes;
- `refactor`: reorganização sem mudança funcional;
- `chore`: manutenção, dependências ou configuração.

Exemplos:

```text
feat: adiciona importação assistida de estoque
fix: preserva valores monetários do XLSX
security: impede acesso cruzado entre organizações
docs: documenta cobrança e implantação
```

## Antes de publicar

1. confira `git status` e o diff;
2. confirme que nenhum `.env`, token ou dado pessoal foi incluído;
3. execute `npm test`;
4. execute `npm run build`;
5. envie `test` para preview;
6. após a validação, faça merge sem reescrever o histórico de `main`.
