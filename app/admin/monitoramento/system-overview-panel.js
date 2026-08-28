"use client";

import { useCallback, useEffect, useState } from "react";

export default function SystemOverviewPanel({ permissions, onNavigate }) {
  const [overview, setOverview] = useState(null);
  const [state, setState] = useState({ loading: true, error: "" });

  const load = useCallback(async () => {
    setState({ loading: true, error: "" });
    try {
      const response = await fetch("/api/admin/overview?private=1", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || body.restricted) throw new Error(body.error || "Acesso restrito às métricas globais.");
      setOverview(body);
      setState({ loading: false, error: "" });
    } catch (error) {
      setState({ loading: false, error: error.message });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (state.loading) {
    return <section className="monitor-panel"><div className="monitor-panel-heading"><div><h2>Visão do sistema</h2><p>Carregando métricas privadas da plataforma…</p></div></div></section>;
  }

  if (state.error || !overview) {
    return <section className="monitor-panel"><div className="monitor-alert" role="alert">{state.error || "Não foi possível consultar as métricas."} <button onClick={load}>Tentar novamente</button></div></section>;
  }

  const { metrics, health } = overview;
  return <section className="monitor-panel" aria-labelledby="system-overview-title">
    <div className="monitor-panel-heading">
      <div>
        <span className="monitor-kicker">ACESSO DO PROPRIETÁRIO</span>
        <h2 id="system-overview-title">Visão do sistema</h2>
        <p>Métricas agregadas de uso, capacidade e saúde da plataforma. Nenhum dado financeiro detalhado de clientes é exibido.</p>
      </div>
      <button onClick={load}>Atualizar</button>
    </div>

    <div className="monitor-metrics">
      <article><span><small>Contas cadastradas</small><strong>{metrics.users || 0}</strong><small>Somente quantidade</small></span></article>
      <article><span><small>Espaços ativos</small><strong>{metrics.workspaces || 0}</strong><small>Usuários com workspace</small></span></article>
      <article><span><small>Requisições em 24 h</small><strong>{metrics.requests_day || 0}</strong><small>{metrics.requests_ten_minutes || 0} nos últimos 10 min</small></span></article>
      <article><span><small>Pico por origem</small><strong>{metrics.peak_per_identity || 0}</strong><small>Por janela de um minuto</small></span></article>
    </div>

    <div className="monitor-ticket-list">
      <article className="monitor-ticket">
        <header><div><span className="ticket-status approved">Saúde</span><h3>Infraestrutura</h3></div></header>
        <p>Servidor: <strong>{health.server === "online" ? "Online" : "Indisponível"}</strong> · Banco de dados: <strong>{health.database === "online" ? "Online" : "Indisponível"}</strong> · Tráfego: <strong>{health.trafficLevel === "normal" ? "Normal" : health.trafficLevel === "attention" ? "Atenção" : "Crítico"}</strong>.</p>
        <small>Atualizado em {new Date(health.checkedAt).toLocaleString("pt-BR")}.</small>
      </article>

      <article className="monitor-ticket">
        <header><div><span className="ticket-status answered">Atalhos</span><h3>Operação</h3></div></header>
        <p>Abra diretamente o módulo que exige atenção sem voltar para a navegação principal.</p>
        <div className="monitor-ticket-actions">
          {permissions?.canMonitor && <button onClick={() => onNavigate?.("events")}>Abrir incidentes</button>}
          {permissions?.canSupport && <button onClick={() => onNavigate?.("tickets")}>Abrir suporte</button>}
          {permissions?.canBilling && <button onClick={() => onNavigate?.("payments")}>Abrir cobrança</button>}
        </div>
      </article>
    </div>
  </section>;
}
