"use client";

import { useCallback, useEffect, useState } from "react";

function formatJson(value) {
  if (value === null || value === undefined) return "—";
  return JSON.stringify(value, null, 2);
}

export default function AuditPanel() {
  const [data, setData] = useState({ items: [], nextCursor: null, policy: null });
  const [state, setState] = useState({ loading: true, loadingMore: false, error: "" });

  const load = useCallback(async (cursor = null) => {
    setState((current) => ({ ...current, [cursor ? "loadingMore" : "loading"]: true, error: "" }));
    try {
      const response = await fetch(`/api/admin/audit${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível consultar a auditoria.");
      setData((current) => ({ ...body, items: cursor ? [...current.items, ...body.items] : body.items }));
      setState({ loading: false, loadingMore: false, error: "" });
    } catch (error) {
      setState({ loading: false, loadingMore: false, error: error.message });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (state.loading) return <section className="monitor-panel"><div className="monitor-empty"><strong>Carregando trilha de auditoria…</strong></div></section>;

  return <section className="monitor-panel audit-panel">
    <div className="monitor-panel-heading"><div><h2>Trilha de auditoria</h2><p>Acesso exclusivo da conta raiz com MFA. Cada consulta também é registrada.</p></div><span>{data.items.length} evento(s) carregado(s)</span></div>
    <div className="audit-policy"><strong>Retenção protegida</strong><span>Nenhum evento é excluído automaticamente até a aprovação dos prazos jurídicos e operacionais.</span></div>
    {state.error && <div className="monitor-alert" role="alert">{state.error}<button onClick={() => load()}>Tentar novamente</button></div>}
    <div className="monitor-ticket-list">{!data.items.length ? <div className="monitor-empty"><strong>Nenhum evento auditável registrado</strong></div> : data.items.map((event) => <article className="audit-event" key={event.id}>
      <header><div><code>{event.action}</code><strong>{event.subjectType || "evento"}{event.subjectId ? ` · ${event.subjectId}` : ""}</strong></div><time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString("pt-BR")}</time></header>
      <p>Autor: {event.actor ? `${event.actor.name}${event.actor.email ? ` (${event.actor.email})` : ""}` : "sistema"} · Empresa: {event.organization?.name || "não vinculada"} · Origem: {event.origin}</p>
      {(event.previousState !== null || event.newState !== null) && <details><summary>Ver alteração</summary><div><section><strong>Antes</strong><pre>{formatJson(event.previousState)}</pre></section><section><strong>Depois</strong><pre>{formatJson(event.newState)}</pre></section></div></details>}
      {event.metadata && Object.keys(event.metadata).length > 0 && <details><summary>Ver metadados minimizados</summary><pre>{formatJson(event.metadata)}</pre></details>}
    </article>)}</div>
    {data.nextCursor && <div className="audit-load-more"><button disabled={state.loadingMore} onClick={() => load(data.nextCursor)}>{state.loadingMore ? "Carregando…" : "Carregar mais eventos"}</button></div>}
  </section>;
}
