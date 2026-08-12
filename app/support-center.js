"use client";

import { useCallback, useEffect, useState } from "react";

const channelLabel = { site: "Resposta dentro da CandTech", email: "E-mail", phone: "Telefone" };
const statusLabel = { open: "Aguardando atendimento", answered: "Respondido", closed: "Encerrado" };

function SupportIcon({ type }) {
  const path = type === "mail"
    ? <><path d="M3 6.5 12 13l9-6.5"/><rect x="3" y="5" width="18" height="14" rx="2"/></>
    : type === "phone"
      ? <path d="M7.2 3h3l1.4 4-2 1.5a15 15 0 0 0 5.9 5.9l1.5-2 4 1.4v3A3.2 3.2 0 0 1 17.8 20C10.2 19.5 4.5 13.8 4 6.2A3.2 3.2 0 0 1 7.2 3Z"/>
      : <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-5 4v-4.5A2.5 2.5 0 0 1 4 13.5Z"/><path d="M8 8h8M8 12h5"/></>;
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{path}</svg>;
}

export default function SupportCenter() {
  const [data, setData] = useState({ tickets: [], contact: null });
  const [form, setForm] = useState({ subject: "", message: "", preferredChannel: "site" });
  const [state, setState] = useState({ loading: true, sending: false, message: "", error: "" });

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/support", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível carregar o suporte.");
      setData(body);
      setState((current) => ({ ...current, loading: false, error: "" }));
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: error.message }));
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => { if (!document.hidden) load(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function submit(event) {
    event.preventDefault();
    setState((current) => ({ ...current, sending: true, error: "", message: "" }));
    try {
      const response = await fetch("/api/support", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível enviar a mensagem.");
      setForm({ subject: "", message: "", preferredChannel: "site" });
      setState((current) => ({ ...current, sending: false, message: "Mensagem enviada. Você poderá acompanhar a resposta abaixo." }));
      await load();
    } catch (error) {
      setState((current) => ({ ...current, sending: false, error: error.message }));
    }
  }

  return <div className="business-stack support-center">
    <section className="panel support-hero">
      <div><span className="eyebrow">ATENDIMENTO CANDTECH</span><h2>Como podemos ajudar?</h2><p>Fale diretamente com o suporte e acompanhe a resposta sem sair do sistema.</p></div>
      <button type="button" className="secondary-button" onClick={load} disabled={state.loading}>Atualizar mensagens</button>
    </section>
    <div className="support-contact-grid">
      <a className="support-contact-card" href={`mailto:${data.contact?.email || ""}`}><SupportIcon type="mail"/><span><small>E-mail</small><strong>{data.contact?.email || "Carregando…"}</strong></span></a>
      <a className="support-contact-card" href={`tel:${data.contact?.phone || ""}`}><SupportIcon type="phone"/><span><small>Telefone</small><strong>{data.contact?.phone || "Carregando…"}</strong></span></a>
      <a className="support-contact-card" href={data.contact?.whatsapp ? `https://wa.me/${data.contact.whatsapp}` : "#"} target="_blank" rel="noreferrer"><SupportIcon type="chat"/><span><small>WhatsApp</small><strong>Iniciar conversa</strong></span></a>
    </div>
    <section className="panel">
      <div className="panel-heading"><div><span className="eyebrow">MENSAGEM PELO SISTEMA</span><h2>Abra um chamado</h2><p>Não envie senhas, chaves de API, dados de cartão ou documentos pessoais.</p></div></div>
      <form className="support-form" onSubmit={submit}>
        <label>Assunto<input value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} minLength="4" maxLength="120" required /></label>
        <label>Como prefere receber a resposta?<select value={form.preferredChannel} onChange={(event) => setForm({ ...form, preferredChannel: event.target.value })}><option value="site">Pelo próprio sistema</option><option value="email">Por e-mail</option><option value="phone">Por telefone</option></select></label>
        <label className="support-message-field">Descreva o que aconteceu<textarea value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} minLength="10" maxLength="4000" rows="6" required placeholder="O que você estava fazendo, o que esperava e o que apareceu?" /></label>
        <button className="primary-button" type="submit" disabled={state.sending}>{state.sending ? "Enviando…" : "Enviar mensagem"}</button>
      </form>
      <div className="support-feedback" aria-live="polite">{state.error && <p className="negative" role="alert">{state.error}</p>}{state.message && <p className="positive">{state.message}</p>}</div>
    </section>
    <section className="panel">
      <div className="panel-heading"><div><span className="eyebrow">ACOMPANHAMENTO</span><h2>Suas mensagens</h2><p>As respostas são atualizadas automaticamente a cada 30 segundos.</p></div></div>
      <div className="support-ticket-list">
        {state.loading && !data.tickets.length ? <p>Carregando mensagens…</p> : !data.tickets.length ? <div className="support-empty"><SupportIcon type="chat"/><p>Você ainda não enviou mensagens ao suporte.</p></div> : data.tickets.map((ticket) => <article className="support-ticket" key={ticket.id}>
          <header><div><strong>{ticket.subject}</strong><small>{new Date(ticket.createdAt).toLocaleString("pt-BR")} · {channelLabel[ticket.preferredChannel]}</small></div><span className={`ticket-status ${ticket.status}`}>{statusLabel[ticket.status]}</span></header>
          <p>{ticket.message}</p>
          {ticket.reply && <div className="support-reply"><strong>Resposta da CandTech</strong><p>{ticket.reply}</p><small>{ticket.repliedAt ? new Date(ticket.repliedAt).toLocaleString("pt-BR") : ""}</small></div>}
        </article>)}
      </div>
    </section>
  </div>;
}
