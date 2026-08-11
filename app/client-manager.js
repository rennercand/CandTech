"use client";

import { useMemo, useState } from "react";

const emptyClient = () => ({
  name: "", phone: "", email: "", status: "active", notes: "",
});

function newId() {
  return globalThis.crypto?.randomUUID?.() || `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function phoneLink(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  return `https://wa.me/${digits.startsWith("55") ? digits : `55${digits}`}`;
}

export default function ClientManager({ clients, setClients, orders = [] }) {
  const [form, setForm] = useState(emptyClient);
  const [search, setSearch] = useState("");
  const orderClients = useMemo(() => [...new Set(orders
    .filter((order) => order.type === "venda" && order.partner?.trim())
    .map((order) => order.partner.trim()))], [orders]);
  const knownNames = new Set(clients.map((client) => client.name.toLocaleLowerCase("pt-BR")));
  const suggestions = orderClients.filter((name) => !knownNames.has(name.toLocaleLowerCase("pt-BR")));
  const visible = clients.filter((client) => `${client.name} ${client.email} ${client.phone}`.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR")));

  function saveClient(event) {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) return;
    setClients((current) => [...current, { ...form, id: newId(), name, createdAt: new Date().toISOString() }]);
    setForm(emptyClient());
  }

  function updateClient(id, field, value) {
    setClients((current) => current.map((client) => client.id === id ? { ...client, [field]: value } : client));
  }

  function importSuggestion(name) {
    setClients((current) => [...current, { ...emptyClient(), id: newId(), name, createdAt: new Date().toISOString() }]);
  }

  return <div className="business-stack client-manager">
    <section className="panel client-toolbar">
      <div><span className="eyebrow">RELACIONAMENTO</span><h2>Clientes em um só lugar</h2><p>Registre contatos e abra WhatsApp ou e-mail sem copiar dados entre telas.</p></div>
      <label>Pesquisar<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nome, e-mail ou telefone" /></label>
    </section>

    <section className="client-summary-grid">
      <article className="stat-card"><span>Total de clientes</span><strong>{clients.length}</strong><small>Contatos cadastrados</small></article>
      <article className="stat-card"><span>Clientes ativos</span><strong>{clients.filter((client) => client.status === "active").length}</strong><small>Disponíveis para relacionamento</small></article>
      <article className="stat-card"><span>Vindos de pedidos</span><strong>{orderClients.length}</strong><small>Nomes encontrados nas vendas</small></article>
    </section>

    <section className="panel">
      <div className="panel-heading"><div><span className="eyebrow">NOVO CONTATO</span><h2>Cadastrar cliente</h2></div></div>
      <form className="client-form" onSubmit={saveClient}>
        <label>Nome<input required maxLength="100" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label>Telefone / WhatsApp<input inputMode="tel" maxLength="24" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
        <label>E-mail<input type="email" maxLength="160" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
        <label>Status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option value="active">Ativo</option><option value="lead">Potencial cliente</option><option value="inactive">Inativo</option></select></label>
        <label className="client-notes">Observações<input maxLength="240" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Preferências, último atendimento…" /></label>
        <button className="primary-button" type="submit">+ Adicionar cliente</button>
      </form>
    </section>

    {suggestions.length > 0 && <section className="panel client-suggestions"><div><span className="eyebrow">PEDIDOS</span><h2>Clientes encontrados nas vendas</h2><p>Importe os nomes que ainda não estão na sua carteira.</p></div><div>{suggestions.map((name) => <button type="button" className="secondary-button" key={name} onClick={() => importSuggestion(name)}>+ {name}</button>)}</div></section>}

    <section className="panel">
      <div className="panel-heading"><div><span className="eyebrow">CARTEIRA</span><h2>Seus clientes</h2></div><strong>{visible.length} contato(s)</strong></div>
      {!visible.length ? <p className="empty-state">Nenhum cliente encontrado. Cadastre o primeiro contato acima.</p> : <div className="client-list">{visible.map((client) => {
        const whatsapp = phoneLink(client.phone);
        return <article className="client-card" key={client.id}>
          <div className="client-avatar">{client.name?.[0]?.toUpperCase() || "C"}</div>
          <div className="client-card-copy"><strong>{client.name}</strong><span>{client.phone || "Sem telefone"} · {client.email || "Sem e-mail"}</span><small>{client.notes || "Sem observações"}</small></div>
          <select aria-label={`Status de ${client.name}`} value={client.status} onChange={(event) => updateClient(client.id, "status", event.target.value)}><option value="active">Ativo</option><option value="lead">Potencial</option><option value="inactive">Inativo</option></select>
          <div className="client-actions">{whatsapp && <a className="secondary-button compact" href={whatsapp} target="_blank" rel="noreferrer">WhatsApp</a>}{client.email && <a className="secondary-button compact" href={`mailto:${client.email}`}>E-mail</a>}<button type="button" className="remove-row" aria-label={`Excluir ${client.name}`} onClick={() => { if (confirm(`Excluir o cliente ${client.name}?`)) setClients((current) => current.filter((item) => item.id !== client.id)); }}>×</button></div>
        </article>;
      })}</div>}
    </section>
  </div>;
}
