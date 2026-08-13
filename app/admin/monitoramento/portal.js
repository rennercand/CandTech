"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const ticketStatus = { open: "Novo", answered: "Respondido", closed: "Encerrado" };
const paymentStatus = { pending: "Aguardando", approved: "Aprovado", rejected: "Recusado", expired: "Expirado" };

function Icon({ type }) {
  const paths = {
    pulse: <><path d="M3 12h4l2-6 4 12 2-6h6"/><circle cx="12" cy="12" r="10"/></>,
    alert: <><path d="m12 3 10 18H2Z"/><path d="M12 9v4M12 17h.01"/></>,
    inbox: <><path d="M4 4h16v16H4Z"/><path d="M4 14h5l2 2h2l2-2h5"/></>,
    payment: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/></>,
    refresh: <><path d="M20 6v5h-5"/><path d="M19 11a7 7 0 1 0 1 5"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[type]}</svg>;
}

export default function MonitoringPortal({ administratorName }) {
  const [data, setData] = useState({ events: [], tickets: [], payments: [], totals: {}, checkedAt: null });
  const [view, setView] = useState("events");
  const [state, setState] = useState({ loading: true, updating: "", error: "" });
  const [replies, setReplies] = useState({});

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/monitoring", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Falha ao atualizar o painel.");
      setData(body);
      setState((current) => ({ ...current, loading: false, error: "" }));
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: error.message }));
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => { if (!document.hidden) load(); }, 20_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function update(payload, key) {
    setState((current) => ({ ...current, updating: key, error: "" }));
    try {
      const response = await fetch("/api/admin/monitoring", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível atualizar.");
      await load();
      setState((current) => ({ ...current, updating: "" }));
    } catch (error) {
      setState((current) => ({ ...current, updating: "", error: error.message }));
    }
  }

  const lastUpdate = useMemo(() => data.checkedAt ? new Date(data.checkedAt).toLocaleTimeString("pt-BR") : "—", [data.checkedAt]);

  return <main className="monitor-page">
    <aside className="monitor-sidebar">
      <a className="monitor-brand" href="/"><img src="/candtech-mark.svg" alt=""/><span>CandTech<small>Operações privadas</small></span></a>
      <nav aria-label="Seções do monitoramento">
        <button className={view === "events" ? "active" : ""} onClick={() => setView("events")}><Icon type="pulse"/>Incidentes</button>
        <button className={view === "tickets" ? "active" : ""} onClick={() => setView("tickets")}><Icon type="inbox"/>Mensagens</button>
        <button className={view === "payments" ? "active" : ""} onClick={() => setView("payments")}><Icon type="payment"/>Pagamentos Pix</button>
      </nav>
      <div className="monitor-private-note"><strong>Acesso privado</strong><span>Permitido apenas para contas em ADMIN_EMAILS.</span></div>
      <a className="monitor-back" href="/">Voltar ao ERP</a>
    </aside>
    <section className="monitor-content">
      <header className="monitor-header"><div><span className="monitor-kicker">CENTRAL DE CONFIABILIDADE</span><h1>Monitoramento e suporte</h1><p>Olá, {administratorName}. Última atualização às {lastUpdate}.</p></div><button onClick={load} disabled={state.loading}><Icon type="refresh"/>{state.loading ? "Atualizando…" : "Atualizar agora"}</button></header>
      <div className="monitor-metrics">
        <article><Icon type="alert"/><span><small>Incidentes ativos</small><strong>{data.totals.openEvents || 0}</strong></span></article>
        <article><Icon type="pulse"/><span><small>Erros críticos</small><strong>{data.totals.criticalEvents || 0}</strong></span></article>
        <article><Icon type="inbox"/><span><small>Mensagens novas</small><strong>{data.totals.openTickets || 0}</strong></span></article>
        <article><Icon type="payment"/><span><small>Pix aguardando</small><strong>{data.totals.pendingPayments || 0}</strong></span></article>
      </div>
      {state.error && <div className="monitor-alert" role="alert">{state.error} <button onClick={load}>Tentar novamente</button></div>}
      {view === "events" && <section className="monitor-panel"><div className="monitor-panel-heading"><div><h2>Incidentes e alertas</h2><p>Falhas iguais são agrupadas; dados sensíveis e mensagens de banco não aparecem aqui.</p></div><span>Atualização automática: 20 s</span></div>
        <div className="monitor-event-list">{!data.events.length ? <div className="monitor-empty"><Icon type="pulse"/><strong>Nenhum incidente registrado</strong><span>O sistema começará a preencher esta lista quando detectar uma falha autenticada.</span></div> : data.events.map((item) => <article className={`monitor-event ${item.level}`} key={item.id}>
          <div className="monitor-event-main"><span className={`monitor-severity ${item.level}`}>{item.level === "error" ? "Erro" : item.level === "warning" ? "Alerta" : "Informação"}</span><div><strong>{item.summary}</strong><p><code>{item.code}</code> · {item.source} · {item.environment || "ambiente desconhecido"}</p><small>{item.route || "Rota não informada"} · visto {item.occurrences} vez(es) · {new Date(item.lastSeenAt).toLocaleString("pt-BR")}</small></div></div>
          <label>Status<select value={item.status} disabled={state.updating === item.id} onChange={(event) => update({ type: "event", id: item.id, status: event.target.value }, item.id)}><option value="open">Aberto</option><option value="investigating">Investigando</option><option value="resolved">Resolvido</option></select></label>
        </article>)}</div>
      </section>}
      {view === "tickets" && <section className="monitor-panel"><div className="monitor-panel-heading"><div><h2>Mensagens recebidas</h2><p>Chamados enviados pela aba Suporte do ERP.</p></div><span>{data.tickets.length} registro(s)</span></div>
        <div className="monitor-ticket-list">{!data.tickets.length ? <div className="monitor-empty"><Icon type="inbox"/><strong>Nenhuma mensagem recebida</strong></div> : data.tickets.map((ticket) => <article className="monitor-ticket" key={ticket.id}>
          <header><div><span className={`ticket-status ${ticket.status}`}>{ticketStatus[ticket.status]}</span><h3>{ticket.subject}</h3><small>{ticket.requester.name} · {ticket.requester.email}{ticket.requester.phone ? ` · ${ticket.requester.phone}` : ""} · {new Date(ticket.createdAt).toLocaleString("pt-BR")}</small></div><span className="monitor-channel">Preferência: {ticket.preferredChannel === "site" ? "site" : ticket.preferredChannel === "email" ? "e-mail" : "telefone"}</span></header>
          <p>{ticket.message}</p>
          {ticket.reply && <div className="monitor-old-reply"><strong>Resposta atual</strong><p>{ticket.reply}</p></div>}
          <label>Responder<textarea rows="4" maxLength="4000" value={replies[ticket.id] ?? ticket.reply ?? ""} onChange={(event) => setReplies({ ...replies, [ticket.id]: event.target.value })}/></label>
          <div className="monitor-ticket-actions"><select value={ticket.status} onChange={(event) => update({ type: "ticket", id: ticket.id, reply: replies[ticket.id] ?? ticket.reply, status: event.target.value }, ticket.id)}><option value="open">Novo</option><option value="answered">Respondido</option><option value="closed">Encerrado</option></select><button disabled={state.updating === ticket.id || !(replies[ticket.id] ?? ticket.reply ?? "").trim()} onClick={() => update({ type: "ticket", id: ticket.id, reply: replies[ticket.id] ?? ticket.reply, status: "answered" }, ticket.id)}>{state.updating === ticket.id ? "Salvando…" : "Enviar resposta"}</button></div>
        </article>)}</div>
      </section>}
      {view === "payments" && <section className="monitor-panel"><div className="monitor-panel-heading"><div><h2>Conferência manual de Pix</h2><p>Aprovar libera a empresa por 30 dias. Recusar suspende o acesso e inicia o envio seguro do backup ao titular.</p></div><span>{data.payments.length} registro(s)</span></div>
        <div className="monitor-ticket-list">{!data.payments.length ? <div className="monitor-empty"><Icon type="payment"/><strong>Nenhum pagamento Pix registrado</strong></div> : data.payments.map((payment) => <article className="monitor-ticket" key={payment.id}>
          <header><div><span className={`ticket-status ${payment.status}`}>{paymentStatus[payment.status]}</span><h3>{payment.txid}</h3><small>{payment.customer?.name} · {payment.customer?.email}{payment.customer?.phone ? ` · ${payment.customer.phone}` : ""}</small></div><strong>{(payment.amountCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</strong></header>
          <p>{payment.kind === "initial" ? "Primeira mensalidade + implantação" : "Renovação mensal"}. Solicitado em {new Date(payment.createdAt).toLocaleString("pt-BR")}; vence em {new Date(payment.dueAt).toLocaleString("pt-BR")}.</p>
          {payment.backupSentAt && <div className="monitor-old-reply"><strong>Backup enviado</strong><p>{new Date(payment.backupSentAt).toLocaleString("pt-BR")}</p></div>}
          {payment.status === "pending" && <div className="monitor-ticket-actions"><button disabled={state.updating === payment.id} onClick={() => update({ type: "payment", id: payment.id, action: "reject" }, payment.id)}>Recusar e suspender</button><button disabled={state.updating === payment.id} onClick={() => update({ type: "payment", id: payment.id, action: "approve" }, payment.id)}>{state.updating === payment.id ? "Salvando…" : "Confirmar recebimento"}</button></div>}
        </article>)}</div>
      </section>}
    </section>
  </main>;
}
