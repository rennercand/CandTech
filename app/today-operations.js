"use client";

import { useCallback, useEffect, useState } from "react";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export default function TodayOperations({ onOpen }) {
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [cashBusy, setCashBusy] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/today", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Falha ao carregar");
      setSnapshot(body.snapshot);
    } catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  async function submitCash(event) {
    event.preventDefault(); setCashBusy(true); setError("");
    try {
      const response = await fetch("/api/today", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ counted: Number(counted), note }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Falha ao conferir o caixa");
      setCounted(""); setNote(""); await load();
    } catch (requestError) { setError(requestError.message); }
    finally { setCashBusy(false); }
  }

  if (loading && !snapshot) return <section className="panel today-loading"><span className="eyebrow">HOJE</span><h2>Organizando as prioridades…</h2></section>;
  if (error && !snapshot) return <section className="panel today-loading"><span className="eyebrow">HOJE</span><h2>Não foi possível carregar as prioridades</h2><p>{error}</p><button className="secondary-button" onClick={load}>Tentar novamente</button></section>;
  return <section className="today-board" aria-label="Prioridades de hoje">
    <div className="today-heading"><div><span className="eyebrow">FILA OPERACIONAL</span><h2>O que precisa da sua atenção</h2><p>Valores, prazos e exceções reunidos para você agir primeiro no que pode parar a operação ou o caixa.</p></div><button className="secondary-button compact" onClick={load} disabled={loading}>{loading ? "Atualizando…" : "Atualizar"}</button></div>
    {snapshot.summary.length > 0 && <div className="today-summary">{snapshot.summary.map((item) => <button key={item.id} className={`today-metric ${item.tone}`} onClick={() => onOpen(item.target)}><span>{item.label}</span><strong>{item.amount !== undefined ? currency.format(item.amount) : item.value}</strong>{item.amount !== undefined && <small>{item.value} {item.value === 1 ? "item" : "itens"}</small>}</button>)}</div>}
    {snapshot.cash && <form className="today-cash-check" onSubmit={submitCash}><div><span className="eyebrow">CONFERÊNCIA DO CAIXA PRINCIPAL</span><strong>Esperado agora: {currency.format(snapshot.cash.expected)}</strong><small>{snapshot.cash.counted === null ? "Ainda não conferido hoje" : `Última contagem ${currency.format(snapshot.cash.counted)} · diferença ${currency.format(snapshot.cash.difference)}`}</small></div><label>Saldo contado<input required type="number" step="0.01" value={counted} onChange={(event) => setCounted(event.target.value)} placeholder="0,00" /></label><label>Observação opcional<input maxLength="240" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ex.: retirada ainda não lançada" /></label><button className="primary-button compact" disabled={cashBusy}>{cashBusy ? "Salvando…" : "Conferir caixa"}</button></form>}
    {error && snapshot && <p className="inline-message error">{error}</p>}
    {snapshot.clear ? <div className="today-clear"><strong>Nenhuma exceção para agora</strong><span>As áreas liberadas para o seu cargo não possuem atrasos, vencimentos ou alertas operacionais hoje.</span></div>
      : <div className="today-groups">{snapshot.groups.map((group) => <article className={`today-group ${group.tone}`} key={group.id}><header><div><strong>{group.title}</strong><span>{group.description}</span></div><button className="text-button" onClick={() => onOpen(group.target)}>{group.action}</button></header>{group.items?.length > 0 && <div className="today-items">{group.items.map((item) => <div key={item.id}><span className={`today-dot ${item.tone}`} /><span><strong>{item.title}</strong><small>{item.detail}</small></span>{item.amount !== undefined && <b>{currency.format(item.amount)}</b>}</div>)}</div>}</article>)}</div>}
  </section>;
}
