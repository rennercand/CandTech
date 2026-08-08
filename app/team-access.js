"use client";

import { useEffect, useState } from "react";

const DEFAULTS = {
  manager: ["dashboard", "calculator", "financing", "pricing", "cashflow", "inventory", "commerce", "history", "exports", "drive"],
  attendant: ["inventory", "commerce"],
};

function PermissionChecks({ areas, permissions, onChange, disabled = false }) {
  return (
    <div className="team-permissions">
      {areas.map((area) => (
        <label key={area.id}>
          <input
            type="checkbox"
            checked={permissions.includes(area.id)}
            disabled={disabled}
            onChange={(event) => onChange(event.target.checked
              ? [...permissions, area.id]
              : permissions.filter((permission) => permission !== area.id))}
          />
          <span>{area.label}</span>
        </label>
      ))}
    </div>
  );
}

function MemberCard({ member, areas, onSaved, onRemoved }) {
  const [draft, setDraft] = useState(member);
  const [busy, setBusy] = useState(false);
  const owner = member.role === "owner";
  async function save() {
    setBusy(true);
    const response = await fetch("/api/team", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: member.id, role: draft.role, permissions: draft.permissions, status: draft.status }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) return onSaved(data.error || "Não foi possível atualizar o acesso.", true);
    onSaved("Permissões atualizadas.");
  }
  async function remove() {
    if (!confirm(`Remover o acesso de ${member.name}?`)) return;
    setBusy(true);
    const response = await fetch("/api/team", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "member", id: member.id }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) return onSaved(data.error || "Não foi possível remover o acesso.", true);
    onRemoved();
  }
  return (
    <article className={`team-member-card ${draft.status === "suspended" ? "suspended" : ""}`}>
      <div className="team-member-identity">
        <span className="avatar">{member.name?.[0]?.toUpperCase() || "?"}</span>
        <div><strong>{member.name}</strong><small>{member.email}</small></div>
        {owner && <span className="role-pill">Proprietário</span>}
      </div>
      {owner ? (
        <p className="team-owner-note">Titular da empresa e responsável pela assinatura. Possui acesso integral e não pode ser removido.</p>
      ) : (
        <>
          <div className="team-role-row">
            <label>Função<select value={draft.role} onChange={(event) => setDraft((current) => ({ ...current, role: event.target.value }))}><option value="manager">Gerente</option><option value="attendant">Funcionário / atendente</option></select></label>
            <label>Situação<select value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))}><option value="active">Ativo</option><option value="suspended">Suspenso</option></select></label>
          </div>
          <PermissionChecks areas={areas} permissions={draft.permissions} onChange={(permissions) => setDraft((current) => ({ ...current, permissions }))} />
          <div className="module-actions"><button className="secondary-button danger-button" disabled={busy} onClick={remove}>Remover acesso</button><button className="primary-button" disabled={busy} onClick={save}>{busy ? "Salvando…" : "Salvar permissões"}</button></div>
        </>
      )}
    </article>
  );
}

export default function TeamAccess() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ email: "", role: "attendant", permissions: DEFAULTS.attendant });
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastInvite, setLastInvite] = useState(null);

  async function load() {
    const response = await fetch("/api/team", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) { setIsError(true); setMessage(body.error || "Não foi possível carregar a equipe."); return; }
    setData(body);
  }
  useEffect(() => { load(); }, []);

  function changeRole(role) {
    setForm((current) => ({ ...current, role, permissions: [...DEFAULTS[role]] }));
  }

  async function invite(event) {
    event.preventDefault();
    setBusy(true); setMessage(""); setLastInvite(null);
    const response = await fetch("/api/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) { setIsError(true); setMessage(body.error || "Não foi possível convidar."); return; }
    setIsError(false);
    setMessage(body.emailSent ? "Convite enviado por e-mail." : "Convite criado. Copie o link abaixo e envie à pessoa.");
    setLastInvite({ url: body.inviteUrl, email: body.invitation.email });
    setForm({ email: "", role: "attendant", permissions: [...DEFAULTS.attendant] });
    load();
  }

  async function removeInvitation(id) {
    const response = await fetch("/api/team", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "invitation", id }) });
    const body = await response.json();
    if (!response.ok) { setIsError(true); setMessage(body.error || "Não foi possível cancelar o convite."); return; }
    setMessage("Convite cancelado."); setIsError(false); load();
  }

  async function copyInvite() {
    await navigator.clipboard.writeText(lastInvite.url);
    setMessage("Link seguro copiado. Ele expira em 72 horas e funciona uma única vez.");
  }

  if (!data) return <section className="panel"><p>{message || "Carregando equipe…"}</p></section>;
  return (
    <div className="business-stack team-access-page">
      <section className="panel team-invite-panel">
        <div className="panel-heading"><div><span className="eyebrow">EQUIPE E SEGURANÇA</span><h2>Acessos de {data.organization.name}</h2><p>Cada pessoa entra com seu próprio e-mail e enxerga somente as áreas marcadas.</p></div><span className="team-limit">{data.members.length + data.invitations.length}/{data.limit} acessos</span></div>
        {!data.emailConfigured && <div className="team-email-warning">O envio automático de e-mail ainda não está configurado. O convite continuará funcionando pelo link seguro copiável.</div>}
        <form className="team-invite-form" onSubmit={invite}>
          <label>E-mail do funcionário<input required type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} placeholder="funcionario@empresa.com.br" /></label>
          <label>Nível inicial<select value={form.role} onChange={(event) => changeRole(event.target.value)}><option value="manager">Gerente</option><option value="attendant">Funcionário / atendente</option></select></label>
          <div className="team-permission-field"><span>Áreas permitidas</span><PermissionChecks areas={data.areas} permissions={form.permissions} onChange={(permissions) => setForm((current) => ({ ...current, permissions }))} /></div>
          <button className="primary-button" disabled={busy}>{busy ? "Criando convite…" : "Convidar por e-mail"}</button>
        </form>
        {message && <div className={isError ? "team-message error" : "team-message"}>{message}</div>}
        {lastInvite && <div className="team-invite-link"><div><strong>Link para {lastInvite.email}</strong><small>Por segurança, este link completo é mostrado somente agora.</small></div><button className="secondary-button" onClick={copyInvite}>Copiar link</button></div>}
      </section>

      <section className="panel">
        <div className="panel-heading"><div><span className="eyebrow">PESSOAS</span><h2>Proprietário e equipe</h2><p>O servidor aplica estas permissões em cada leitura, alteração e exportação.</p></div></div>
        <div className="team-member-list">{data.members.map((member) => <MemberCard key={member.id} member={member} areas={data.areas} onSaved={(text, error = false) => { setMessage(text); setIsError(error); if (!error) load(); }} onRemoved={load} />)}</div>
      </section>

      {data.invitations.length > 0 && <section className="panel"><div className="panel-heading"><div><span className="eyebrow">PENDENTES</span><h2>Convites aguardando aceite</h2></div></div><div className="pending-invites">{data.invitations.map((invitation) => <div key={invitation.id}><div><strong>{invitation.email}</strong><small>{invitation.role === "manager" ? "Gerente" : "Funcionário / atendente"} · expira {new Date(invitation.expires_at).toLocaleString("pt-BR")}</small></div><button className="text-button danger" onClick={() => removeInvitation(invitation.id)}>Cancelar</button></div>)}</div></section>}
    </div>
  );
}
