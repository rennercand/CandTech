"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import StaffAccessPanel from "./staff-access-panel";
import SystemOverviewPanel from "./system-overview-panel";

const ticketStatus = { open: "Novo", answered: "Respondido", closed: "Encerrado" };
const paymentStatus = { pending: "Aguardando confirmação", payment_review: "Comprovante recebido", approved: "Aprovado", rejected: "Recusado", expired: "Expirado" };

function Icon({ type }) {
  const paths = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    pulse: <><path d="M3 12h4l2-6 4 12 2-6h6"/><circle cx="12" cy="12" r="10"/></>,
    alert: <><path d="m12 3 10 18H2Z"/><path d="M12 9v4M12 17h.01"/></>,
    inbox: <><path d="M4 4h16v16H4Z"/><path d="M4 14h5l2 2h2l2-2h5"/></>,
    payment: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/></>,
    refresh: <><path d="M20 6v5h-5"/><path d="M19 11a7 7 0 1 0 1 5"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[type]}</svg>;
}

function initialView(permissions) {
  if (permissions.canViewSystemOverview) return "overview";
  if (permissions.canMonitor) return "events";
  if (permissions.canSupport) return "tickets";
  if (permissions.canBilling) return "payments";
  return "staff";
}

const viewCopy = {
  overview: { kicker: "OPERAÇÃO CANDTECH", title: "Visão do sistema", description: "Uso, capacidade e saúde da plataforma em uma visão privada." },
  events: { kicker: "CONFIABILIDADE", title: "Incidentes", description: "Falhas atuais, alertas e acompanhamento técnico da produção." },
  tickets: { kicker: "ATENDIMENTO", title: "Suporte", description: "Mensagens dos clientes e respostas da equipe interna." },
  payments: { kicker: "COBRANÇA", title: "Cobrança Pix", description: "Conferência manual, comprovantes opcionais e liberação de assinatura." },
  staff: { kicker: "ACESSO INTERNO", title: "Equipe interna", description: "Permissões operacionais da equipe CandTech." },
};

export default function MonitoringPortal({ administratorName, permissions }) {
  const [data, setData] = useState({ events: [], tickets: [], payments: [], totals: {}, checkedAt: null });
  const [view, setView] = useState(() => initialView(permissions));
  const [state, setState] = useState({ loading: true, updating: "", error: "" });
  const [replies, setReplies] = useState({});
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [receiptPreview, setReceiptPreview] = useState(null);

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
  const filteredPayments = useMemo(() => paymentFilter === "all" ? data.payments : data.payments.filter((item) => item.status === paymentFilter), [data.payments, paymentFilter]);
  const current = viewCopy[view] || viewCopy.events;

  return <main className="monitor-page">
    <aside className="monitor-sidebar">
      <a className="monitor-brand" href="/"><img src="/candtech-mark.svg" alt=""/><span>CandTech<small>Operações privadas</small></span></a>
      <nav aria-label="Seções da central privada">
        {permissions.canViewSystemOverview && <button className={view === "overview" ? "active" : ""} onClick={() => setView("overview")}><Icon type="overview"/>Visão do sistema</button>}
        {permissions.canMonitor && <button className={view === "events" ? "active" : ""} onClick={() => setView("events")}><Icon type="pulse"/>Incidentes{data.totals.criticalEvents ? <span className="monitor-count">{data.totals.criticalEvents}</span> : null}</button>}
        {permissions.canSupport && <button className={view === "tickets" ? "active" : ""} onClick={() => setView("tickets")}><Icon type="inbox"/>Suporte{data.totals.openTickets ? <span className="monitor-count">{data.totals.openTickets}</span> : null}</button>}
        {permissions.canBilling && <button className={view === "payments" ? "active" : ""} onClick={() => setView("payments")}><Icon type="payment"/>Cobrança Pix{data.totals.reviewPayments ? <span className="monitor-count">{data.totals.reviewPayments}</span> : null}</button>}
        {permissions.canManageStaff && <button className={view === "staff" ? "active" : ""} onClick={() => setView("staff")}><Icon type="users"/>Equipe interna</button>}
      </nav>
      <div className="monitor-private-note"><strong>Acesso privado</strong><span>Seu login mostra somente os módulos concedidos.</span></div>
      <a className="monitor-back" href="/">Voltar ao ERP</a>
    </aside>

    <section className="monitor-content">
      <header className="monitor-header">
        <div><span className="monitor-kicker">{current.kicker}</span><h1>{current.title}</h1><p>{current.description} Olá, {administratorName}. Atualizado às {lastUpdate}.</p></div>
        {view !== "overview" && <button onClick={load} disabled={state.loading}><Icon type="refresh"/>{state.loading ? "Atualizando…" : "Atualizar agora"}</button>}
      </header>

      {view !== "overview" && <div className="monitor-metrics">
        {permissions.canMonitor && <article><Icon type="alert"/><span><small>Incidentes ativos</small><strong>{data.totals.openEvents || 0}</strong></span></article>}
        {permissions.canMonitor && <article><Icon type="pulse"/><span><small>Erros críticos</small><strong>{data.totals.criticalEvents || 0}</strong></span></article>}
        {permissions.canSupport && <article><Icon type="inbox"/><span><small>Mensagens novas</small><strong>{data.totals.openTickets || 0}</strong></span></article>}
        {permissions.canBilling && <article><Icon type="payment"/><span><small>Comprovantes para conferir</small><strong>{data.totals.reviewPayments || 0}</strong></span></article>}
      </div>}

      {state.error && view !== "overview" && <div className="monitor-alert" role="alert">{state.error} <button onClick={load}>Tentar novamente</button></div>}
      {permissions.canViewSystemOverview && view === "overview" && <SystemOverviewPanel permissions={permissions} onNavigate={setView} />}

      {permissions.canMonitor && view === "events" && <section className="monitor-panel"><div className="monitor-panel-heading"><div><h2>Incidentes e alertas</h2><p>Falhas iguais são agrupadas; dados sensíveis e mensagens de banco não aparecem aqui.</p></div><span>Atualização automática: 20 s</span></div>
        <div className="monitor-event-list">{!data.events.length ? <div className="monitor-empty"><Icon type="pulse"/><strong>Nenhum incidente registrado</strong><span>O sistema começará a preencher esta lista quando detectar uma falha autenticada.</span></div> : data.events.map((item) => <article className={`monitor-event ${item.level}`} key={item.id}>
          <div className="monitor-event-main"><span className={`monitor-severity ${item.level}`}>{item.level === "error" ? "Erro" : item.level === "warning" ? "Alerta" : "Informação"}</span><div><strong>{item.summary}</strong><p><code>{item.code}</code> · {item.source} · {item.environment || "ambiente desconhecido"}</p><small>{item.route || "Rota não informada"} · visto {item.occurrences} vez(es) · {new Date(item.lastSeenAt).toLocaleString("pt-BR")}</small></div></div>
          <label>Status<select value={item.status} disabled={state.updating === item.id} onChange={(event) => update({ type: "event", id: item.id, status: event.target.value }, item.id)}><option value="open">Aberto</option><option value="investigating">Investigando</option><option value="resolved">Resolvido</option></select></label>
        </article>)}</div>
      </section>}

      {permissions.canSupport && view === "tickets" && <section className="monitor-panel"><div className="monitor-panel-heading"><div><h2>Mensagens recebidas</h2><p>Chamados enviados pela aba Suporte do ERP.</p></div><span>{data.tickets.length} registro(s)</span></div>
        <div className="monitor-ticket-list">{!data.tickets.length ? <div className="monitor-empty"><Icon type="inbox"/><strong>Nenhuma mensagem recebida</strong></div> : data.tickets.map((ticket) => <article className="monitor-ticket" key={ticket.id}>
          <header><div><span className={`ticket-status ${ticket.status}`}>{ticketStatus[ticket.status]}</span><h3>{ticket.subject}</h3><small>{ticket.requester.name} · {ticket.requester.email}{ticket.requester.phone ? ` · ${ticket.requester.phone}` : ""} · {new Date(ticket.createdAt).toLocaleString("pt-BR")}</small></div><span className="monitor-channel">Preferência: {ticket.preferredChannel === "site" ? "site" : ticket.preferredChannel === "email" ? "e-mail" : "telefone"}</span></header>
          <p>{ticket.message}</p>
          {ticket.reply && <div className="monitor-old-reply"><strong>Resposta atual</strong><p>{ticket.reply}</p></div>}
          <label>Responder<textarea rows="4" maxLength="4000" value={replies[ticket.id] ?? ticket.reply ?? ""} onChange={(event) => setReplies({ ...replies, [ticket.id]: event.target.value })}/></label>
          <div className="monitor-ticket-actions"><select value={ticket.status} onChange={(event) => update({ type: "ticket", id: ticket.id, reply: replies[ticket.id] ?? ticket.reply, status: event.target.value }, ticket.id)}><option value="open">Novo</option><option value="answered">Respondido</option><option value="closed">Encerrado</option></select><button disabled={state.updating === ticket.id || !(replies[ticket.id] ?? ticket.reply ?? "").trim()} onClick={() => update({ type: "ticket", id: ticket.id, reply: replies[ticket.id] ?? ticket.reply, status: "answered" }, ticket.id)}>{state.updating === ticket.id ? "Salvando…" : "Enviar resposta"}</button></div>
        </article>)}</div>
      </section>}

      {permissions.canBilling && view === "payments" && <section className="monitor-panel"><div className="monitor-panel-heading"><div><h2>Conferência manual de Pix</h2><p>O comprovante é opcional. Você pode liberar o acesso assim que confirmar o recebimento diretamente no banco.</p></div><span>{filteredPayments.length} registro(s)</span></div>
        <div className="monitor-payment-filters" aria-label="Filtrar pagamentos"><button className={paymentFilter === "all" ? "active" : ""} onClick={() => setPaymentFilter("all")}>Todos</button><button className={paymentFilter === "pending" ? "active" : ""} onClick={() => setPaymentFilter("pending")}>Aguardando confirmação</button><button className={paymentFilter === "payment_review" ? "active" : ""} onClick={() => setPaymentFilter("payment_review")}>Comprovante recebido</button><button className={paymentFilter === "approved" ? "active" : ""} onClick={() => setPaymentFilter("approved")}>Aprovados</button><button className={paymentFilter === "rejected" ? "active" : ""} onClick={() => setPaymentFilter("rejected")}>Recusados</button><button className={paymentFilter === "expired" ? "active" : ""} onClick={() => setPaymentFilter("expired")}>Expirados</button></div>
        <div className="monitor-ticket-list">{!filteredPayments.length ? <div className="monitor-empty"><Icon type="payment"/><strong>Nenhum pagamento neste filtro</strong></div> : filteredPayments.map((payment) => {
          const payerName = payment.customer?.name || "Nome não informado";
          return <article className="monitor-ticket" key={payment.id}>
            <header><div><span className={`ticket-status ${payment.status}`}>{paymentStatus[payment.status]}</span><h3>{payerName}</h3><small>{payment.customer?.email || "E-mail não informado"}</small></div><strong>{(payment.amountCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</strong></header>
            <p><strong>Nome:</strong> {payerName} · <strong>E-mail:</strong> {payment.customer?.email || "Não informado"} · <strong>TXID:</strong> {payment.txid}</p>
            <p>{payment.kind === "initial" ? "Primeira mensalidade + implantação" : "Renovação mensal"}. Solicitado em {new Date(payment.createdAt).toLocaleString("pt-BR")}; vence em {new Date(payment.dueAt).toLocaleString("pt-BR")}.</p>
            {payment.receipt ? <div className="monitor-receipt"><div><strong>Comprovante disponível</strong><span>{payment.receipt.originalFilename} · {(payment.receipt.sizeBytes / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} KB · {new Date(payment.receipt.uploadedAt).toLocaleString("pt-BR")}</span></div><div><button onClick={() => setReceiptPreview(payment)}>Visualizar comprovante</button><a href={`/api/admin/payments/${payment.id}/receipt?download=1`}>Baixar</a></div></div> : ["pending", "payment_review"].includes(payment.status) ? <div className="monitor-old-reply"><strong>Sem comprovante</strong><p>Isso não impede a liberação manual. Confirme apenas se você localizou o recebimento no banco.</p></div> : null}
            {payment.backupSentAt && <div className="monitor-old-reply"><strong>Backup enviado</strong><p>{new Date(payment.backupSentAt).toLocaleString("pt-BR")}</p></div>}
            {["pending", "payment_review"].includes(payment.status) && <div className="monitor-ticket-actions"><button disabled={state.updating === payment.id} onClick={() => update({ type: "payment", id: payment.id, action: "reject" }, payment.id)}>Recusar e suspender</button><button disabled={state.updating === payment.id} onClick={() => update({ type: "payment", id: payment.id, action: "approve" }, payment.id)}>{state.updating === payment.id ? "Salvando…" : payment.status === "payment_review" ? "Confirmar e liberar acesso" : "Liberar acesso manualmente"}</button></div>}
          </article>;
        })}</div>
      </section>}

      {permissions.canManageStaff && view === "staff" && <StaffAccessPanel/>}

      {receiptPreview && <div className="monitor-receipt-modal" role="dialog" aria-modal="true" aria-labelledby="receipt-title"><div><header><div><span>COMPROVANTE PIX</span><h2 id="receipt-title">{receiptPreview.receipt.originalFilename}</h2></div><button aria-label="Fechar comprovante" onClick={() => setReceiptPreview(null)}>×</button></header>{receiptPreview.receipt.contentType === "application/pdf" ? <iframe title={`Comprovante ${receiptPreview.txid}`} src={`/api/admin/payments/${receiptPreview.id}/receipt`}/> : <div className="monitor-receipt-image"><img src={`/api/admin/payments/${receiptPreview.id}/receipt`} alt={`Comprovante do pagamento ${receiptPreview.txid}`}/></div>}<footer><small>Confira também o recebimento na conta bancária antes de aprovar.</small><button onClick={() => setReceiptPreview(null)}>Fechar</button></footer></div></div>}
    </section>
  </main>;
}
