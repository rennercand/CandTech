"use client";

import { useCallback, useEffect, useState } from "react";

const emptyForm = { email: "", canMonitor: false, canSupport: true, canBilling: false };

export default function StaffAccessPanel() {
  const [staff, setStaff] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [state, setState] = useState({ loading: true, saving: false, error: "", success: "" });

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/staff", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível carregar a equipe interna.");
      setStaff(body.staff || []);
      setState((current) => ({ ...current, loading: false, error: "" }));
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: error.message }));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save(event) {
    event.preventDefault();
    setState((current) => ({ ...current, saving: true, error: "", success: "" }));
    try {
      const response = await fetch("/api/admin/staff", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível salvar o acesso.");
      setForm(emptyForm);
      await load();
      setState((current) => ({ ...current, saving: false, success: "Acesso interno atualizado." }));
    } catch (error) {
      setState((current) => ({ ...current, saving: false, error: error.message }));
    }
  }

  async function revoke(item) {
    if (!window.confirm(`Revogar todo o acesso interno de ${item.email}?`)) return;
    setState((current) => ({ ...current, saving: true, error: "", success: "" }));
    try {
      const response = await fetch("/api/admin/staff", {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: item.userId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível revogar o acesso.");
      await load();
      setState((current) => ({ ...current, saving: false, success: "Acesso interno revogado." }));
    } catch (error) {
      setState((current) => ({ ...current, saving: false, error: error.message }));
    }
  }

  function edit(item) {
    setForm({ email: item.email, canMonitor: item.canMonitor, canSupport: item.canSupport, canBilling: item.canBilling });
  }

  return <section className="monitor-panel">
    <div className="monitor-panel-heading"><div><h2>Equipe interna</h2><p>A pessoa cria a própria conta e senha; aqui você concede somente os módulos de trabalho.</p></div><span>{staff.length} acesso(s)</span></div>
    <form className="staff-access-form" onSubmit={save}>
      <label>E-mail da conta CandTech<input type="email" required maxLength="254" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="pessoa@empresa.com"/></label>
      <fieldset><legend>Permissões</legend>
        <label><input type="checkbox" checked={form.canMonitor} onChange={(event) => setForm({ ...form, canMonitor: event.target.checked })}/>Incidentes e saúde do sistema</label>
        <label><input type="checkbox" checked={form.canSupport} onChange={(event) => setForm({ ...form, canSupport: event.target.checked })}/>Ler e responder chamados</label>
        <label><input type="checkbox" checked={form.canBilling} onChange={(event) => setForm({ ...form, canBilling: event.target.checked })}/>Conferir Pix e liberar assinatura</label>
      </fieldset>
      <button disabled={state.saving}>{state.saving ? "Salvando…" : "Conceder ou atualizar"}</button>
    </form>
    {state.error && <div className="monitor-alert" role="alert">{state.error}</div>}
    {state.success && <div className="monitor-alert success" role="status">{state.success}</div>}
    <div className="monitor-ticket-list staff-access-list">{state.loading ? <div className="monitor-empty"><strong>Carregando equipe…</strong></div> : !staff.length ? <div className="monitor-empty"><strong>Nenhum colaborador interno cadastrado</strong><span>O administrador principal continua acessando pela variável ADMIN_EMAILS.</span></div> : staff.map((item) => <article className="monitor-ticket" key={item.userId}>
      <header><div><h3>{item.name || item.email}</h3><small>{item.email} · {item.emailVerified ? "e-mail verificado" : "aguardando verificação"}</small></div></header>
      <div className="staff-permissions"><span className={item.canMonitor ? "enabled" : ""}>Monitoramento</span><span className={item.canSupport ? "enabled" : ""}>Suporte</span><span className={item.canBilling ? "enabled" : ""}>Cobrança</span></div>
      <div className="monitor-ticket-actions"><button type="button" onClick={() => edit(item)}>Editar</button><button type="button" disabled={state.saving} onClick={() => revoke(item)}>Revogar acesso</button></div>
    </article>)}</div>
  </section>;
}
