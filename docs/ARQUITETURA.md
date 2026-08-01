# Mapa do sistema CandTech

O mapa abaixo mostra como navegador, frontend, APIs, banco e serviços externos conversam entre si.

```mermaid
flowchart LR
  U[Usuário] --> UI[Frontend Next.js / React]

  subgraph Navegador
    UI --> CALC[Cálculos e gráficos]
    UI --> PDFJS[Leitor PDF.js]
    PDFJS --> PARSER[Parser de extrato]
    PARSER --> UI
    UI --> EXPORTLOCAL[CSV e solicitação de PDF]
  end

  UI -->|HTTPS + cookie HttpOnly| API[Route Handlers / API]

  subgraph Backend Vercel
    API --> SEC[Validação de origem e rate limit]
    SEC --> AUTH[Autenticação JWT e bcrypt]
    SEC --> HISTORY[Histórico e workspace]
    SEC --> REPORTS[Gerador PDF/CSV/XLSX]
    SEC --> DRIVE[Integração Google Drive]
  end

  AUTH --> DB[(PostgreSQL / Neon)]
  HISTORY --> DB
  SEC --> DB
  DRIVE --> TOKENS[Tokens OAuth cifrados no banco]
  TOKENS --> DB
  DRIVE -->|OAuth 2.0 e drive.file| GOOGLE[Google Drive do usuário]
  REPORTS --> UI
  EXPORTLOCAL --> U
  GOOGLE --> U

  VERCEL[Vercel: hospedagem, HTTPS e firewall] --> API
  GITHUB[GitHub main/test] -->|Deploy automático| VERCEL
```

## Leitura como mapa mental

```mermaid
mindmap
  root((CandTech))
    Interface
      Dashboard
      Calculadoras
      Tabelas financeiras
      Preço do produto
      Organização financeira
      Histórico
    Cálculos locais
      VPL
      TIR
      ROI
      Payback
      Índice de lucratividade
      PRICE e SAF
      SAC
      SAA
    Backend
      Autenticação
      Rate limit
      Workspace automático
      Histórico privado
      Exportações
    Dados
      PostgreSQL Neon em produção
      SQLite no desenvolvimento
      Separação por usuário
      Tokens Google cifrados
    Serviços
      Vercel
      Google Drive
      GitHub
```

## Limites importantes

- O PDF bruto é processado no navegador; os lançamentos extraídos podem ser salvos no workspace do usuário.
- Os cálculos de investimento são periódicos mensais. As datas identificam os fluxos e a data estimada do payback.
- ROE não pertence ao cálculo de projeto atual. Para calculá-lo corretamente seriam necessários lucro líquido contábil e patrimônio líquido médio.
- PRICE/SAF, SAC e SAA são simulações sem seguros, tarifas, tributos ou indexadores contratuais.
