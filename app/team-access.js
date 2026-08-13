"use client";

import { useEffect, useMemo, useState } from "react";

const DEFAULTS = {
  manager: ["dashboard", "calculator", "financing", "pricing", "cashflow", "inventory", "commerce", "history", "exports", "drive"],
  attendant: ["inventory", "commerce"],
};

function PermissionChecks({ areas, permissions, onChange = () => {}, disabled = false }) {
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

function JobCard({ job, areas, onChanged, onMessage }) {
  const [draft, setDraft] = useState(job);
  const [busy, setBusy] = useState(false);

  useEffect(() => setDraft(job), [job]);

  function changeRole(role) {
    setDraft((current) => ({ ...current, role, permissions: [...DEFAULTS[role]] }));
  }

  async function save() {
    setBusy(true);
    const response = await fetch("/api/team/jobs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: job.id, name: draft.name, role: draft.role, permissions: draft.permissions }),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) return onMessage(body.error || "Não foi possível atualizar o cargo.", true);
    onMessage("Cargo e permissões atualizados para os colaboradores vinculados.");
    onChanged();
  }

  async function remove() {
    if (!confirm(`Excluir o cargo “${job.name}”? Os colaboradores atuais manterão o último acesso salvo.`)) return;
    setBusy(true);
    const response = await fetch("/api/team/jobs", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: job.id }),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) return onMessage(body.error || "Não foi possível excluir o cargo.", true);
    onMessage("Cargo excluído. Ele não poderá ser usado em novos convites.");
    onChanged();
  }

  return (
    <article className="team-job-card">
      <div className="team-role-row">
        <label>Nome do cargo<input required maxLength={80} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
        <label>Nível-base<select value={draft.role} onChange={(event) => changeRole(event.target.value)}><option value="manager">Gerente</option><option value="attendant">Colaborador</option></select></label>
      </div>
      <PermissionChecks areas={areas} permissions={draft.permissions} onChange={(permissions) => setDraft((current) => ({ ...current, permissions }))} />
      <div className="module-actions"><button type="button" className="secondary-button danger-button" disabled={busy} onClick={remove}>Excluir cargo</button><button type="button" className="primary-button" disabled={busy || draft.name.trim().length < 2} onClick={save}>{busy ? "Salvando…" : "Salvar cargo"}</button></div>
    </article>
  );
}

function MemberCard({ member, jobs, areas, onSaved, onRemoved }) {
  const matchingJob = useMemo(() => jobs.find((job) => job.name.toLocaleLowerCase("pt-BR") === String(member.job_title || "").toLocaleLowerCase("pt-BR")), [jobs, member.job_title]);
  const [draft, setDraft] = useState({ jobId: matchingJob?.id ? String(matchingJob.id) : "", status: member.status });
  const [busy, setBusy] = useState(false);
  const owner = member.role === "owner";
  const selectedJob = jobs.find((job) => String(job.id) === draft.jobId);

  useEffect(() => {
    setDraft({ jobId: matchingJob?.id ? String(matchingJob.id) : "", status: member.status });
  }, [matchingJob?.id, member.status]);

  async function save() {
    if (!draft.jobId) return onSaved("Selecione um cargo cadastrado para esse colaborador.", true);
    setBusy(true);
    const response = await fetch("/api/team", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: member.id, jobId: Number(draft.jobId), status: draft.status }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) return onSaved(data.error || "Não foi possível atualizar o acesso.", true);
    onSaved("Cargo e acesso do colaborador atualizados.");
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
            <label>Cargo na empresa<select value={draft.jobId} onChange={(event) => setDraft((current) => ({ ...current, jobId: event.target.value }))}><option value="">Selecione um cargo</option>{jobs.map((job) => <option value={job.id} key={job.id}>{job.name}</option>)}</select></label>
            <label>Situação<select value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))}><option value="active">Ativo</option><option value="suspended">Suspenso</option></select></label>
          </div>
          {!matchingJob && member.job_title && <p className="team-legacy-job">Cargo anterior: <strong>{member.job_title}</strong>. Selecione um cargo cadastrado para padronizar este acesso.</p>}
          <PermissionChecks areas={areas} permissions={selectedJob?.permissions || member.permissions} disabled />
          <div className="module-actions"><button type="button" className="secondary-button danger-button" disabled={busy} onClick={remove}>Remover acesso</button><button type="button" className="primary-button" disabled={busy || !draft.jobId} onClick={save}>{busy ? "Salvando…" : "Salvar colaborador"}</button></div>
        </>
      )}
    </article>
  );
}

export default function TeamAccess() {
  const [data, setData] = useState(null);
  const [inviteForm, setInviteForm] = useState({ email: "", jobId: "" });
  const [jobForm, setJobForm] = useState({ name: "", role: "attendant", permissions: [...DEFAULTS.attendant] });
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastInvite, setLastInvite] = useState(null);

  function showMessage(text, error = false) {
    setMessage(text);
    setIsError(error);
  }

  async function load() {
    const response = await fetch("/api/team", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) return showMessage(body.error || "Não foi possível carregar a equipe.", true);
    setData(body);
  }

  useEffect(() => { load(); }, []);

  function changeNewJobRole(role) {
    setJobForm((current) => ({ ...current, role, permissions: [...DEFAULTS[role]] }));
  }

  async function createJob(event) {
    event.preventDefault();
    setBusy(true);
    const response = await fetch("/api/team/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(jobForm),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) return showMessage(body.error || "Não foi possível criar o cargo.", true);
    setJobForm({ name: "", role: "attendant", permissions: [...DEFAULTS.attendant] });
    setInviteForm((current) => ({ ...current, jobId: String(body.job.id) }));
    showMessage(`Cargo ${body.job.name} criado e selecionado para o próximo convite.`);
    load();
  }

  async function invite(event) {
    event.preventDefault();
    setBusy(true); setMessage(""); setLastInvite(null);
    const response = await fetch("/api/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteForm.email, jobId: Number(inviteForm.jobId) }),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) return showMessage(body.error || "Não foi possível convidar.", true);
    showMessage(body.emailSent ? "Convite enviado por e-mail." : "Convite criado. Copie o link abaixo e envie à pessoa.");
    setLastInvite({ url: body.inviteUrl, email: body.invitation.email, jobTitle: body.invitation.job_title });
    setInviteForm({ email: "", jobId: "" });
    load();
  }

  async function removeInvitation(id) {
    const response = await fetch("/api/team", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "invitation", id }) });
    const body = await response.json();
    if (!response.ok) return showMessage(body.error || "Não foi possível cancelar o convite.", true);
    setLastInvite(null);
    showMessage("Convite cancelado."); load();
  }

  async function copyInvite() {
    await navigator.clipboard.writeText(lastInvite.url);
    showMessage("Link seguro copiado. Ele expira em 72 horas e funciona uma única vez.");
  }

  if (!data) return <section className="panel"><p>{message || "Carregando equipe…"}</p></section>;
  const owner = data.members.find((member) => member.role === "owner");
  const collaborators = data.members.filter((member) => member.role !== "owner");
  const selectedInviteJob = data.jobs.find((job) => String(job.id) === inviteForm.jobId);

  return (
    <div className="business-stack team-access-page">
      <section className="panel team-owner-panel">
        <div className="panel-heading"><div><span className="eyebrow">TITULAR DA ASSINATURA</span><h2>Proprietário da operação</h2><p>Este é o e-mail principal da empresa e a conta responsável por solicitar o Pix e receber a confirmação do pagamento.</p></div><span className="role-pill">Acesso integral</span></div>
        {owner && <div className="team-owner-summary"><span className="avatar">{owner.name?.[0]?.toUpperCase() || "?"}</span><div><strong>{owner.name}</strong><small>{owner.email}</small></div><div className="team-owner-badges"><span>Proprietário</span><small>Não pode ser removido nem rebaixado por colaboradores.</small></div></div>}
      </section>

      {message && <div className={isError ? "team-message error" : "team-message"}>{message}</div>}

      <section className="panel team-jobs-panel">
        <div className="panel-heading"><div><span className="eyebrow">CARGOS E PERMISSÕES</span><h2>Crie os cargos da sua empresa</h2><p>Defina o cargo uma vez. Depois basta selecioná-lo no convite ou no cadastro do colaborador.</p></div><span className="team-limit">{data.jobs.length}/{data.jobLimit} cargos</span></div>
        <form className="team-job-form" onSubmit={createJob}>
          <label>Nome do novo cargo<input required minLength={2} maxLength={80} value={jobForm.name} onChange={(event) => setJobForm((current) => ({ ...current, name: event.target.value }))} placeholder="Ex.: Vendedor, Estoquista, Financeiro" /></label>
          <label>Nível-base<select value={jobForm.role} onChange={(event) => changeNewJobRole(event.target.value)}><option value="manager">Gerente</option><option value="attendant">Colaborador</option></select></label>
          <div className="team-permission-field"><span>Áreas permitidas para esse cargo</span><PermissionChecks areas={data.areas} permissions={jobForm.permissions} onChange={(permissions) => setJobForm((current) => ({ ...current, permissions }))} /></div>
          <button className="primary-button" disabled={busy || jobForm.name.trim().length < 2}>{busy ? "Criando…" : "+ Criar cargo"}</button>
        </form>
        {data.jobs.length === 0
          ? <div className="empty-team-state"><strong>Nenhum cargo cadastrado</strong><p>Crie o primeiro cargo para liberar o envio de convites.</p></div>
          : <div className="team-job-list">{data.jobs.map((job) => <JobCard key={job.id} job={job} areas={data.areas} onChanged={load} onMessage={showMessage} />)}</div>}
      </section>

      <section className="panel team-invite-panel">
        <div className="panel-heading"><div><span className="eyebrow">NOVO ACESSO</span><h2>Convidar colaborador por e-mail</h2><p>Informe o e-mail e selecione um cargo. A pessoa autentica a própria conta para aceitar o convite.</p></div><span className="team-limit">{data.members.length + data.invitations.length}/{data.limit} acessos</span></div>
        {!data.emailConfigured && <div className="team-email-warning">O envio automático ainda não está configurado. O convite continuará funcionando pelo link seguro copiável; configure Resend para entregá-lo diretamente no e-mail.</div>}
        <form className="team-invite-form" onSubmit={invite}>
          <label>E-mail do colaborador<input required type="email" value={inviteForm.email} onChange={(event) => setInviteForm((current) => ({ ...current, email: event.target.value }))} placeholder="colaborador@empresa.com.br" /></label>
          <label>Cargo<select required value={inviteForm.jobId} onChange={(event) => setInviteForm((current) => ({ ...current, jobId: event.target.value }))}><option value="">Selecione um cargo</option>{data.jobs.map((job) => <option value={job.id} key={job.id}>{job.name}</option>)}</select></label>
          {selectedInviteJob && <div className="team-permission-field"><span>O convite dará acesso a</span><PermissionChecks areas={data.areas} permissions={selectedInviteJob.permissions} disabled /></div>}
          <button className="primary-button" disabled={busy || !inviteForm.jobId || data.jobs.length === 0}>{busy ? "Enviando convite…" : "Enviar convite"}</button>
        </form>
        {lastInvite && <div className="team-invite-link"><div><strong>{lastInvite.jobTitle} · {lastInvite.email}</strong><small>Por segurança, este link completo é mostrado somente agora.</small></div><button type="button" className="secondary-button" onClick={copyInvite}>Copiar link</button></div>}
      </section>

      <section className="panel">
        <div className="panel-heading"><div><span className="eyebrow">COLABORADORES</span><h2>Acessos da empresa</h2><p>Troque o cargo para aplicar o conjunto de permissões cadastrado. A situação suspende ou reativa a entrada da pessoa.</p></div></div>
        {collaborators.length === 0
          ? <div className="empty-team-state"><strong>Nenhum colaborador ativo</strong><p>Envie um convite e aguarde a pessoa autenticar a conta para aceitar.</p></div>
          : <div className="team-member-list">{collaborators.map((member) => <MemberCard key={member.id} member={member} jobs={data.jobs} areas={data.areas} onSaved={(text, error = false) => { showMessage(text, error); if (!error) load(); }} onRemoved={load} />)}</div>}
      </section>

      {data.invitations.length > 0 && <section className="panel"><div className="panel-heading"><div><span className="eyebrow">PENDENTES</span><h2>Convites aguardando autenticação</h2></div></div><div className="pending-invites">{data.invitations.map((invitation) => <div key={invitation.id}><div><strong>{invitation.email}</strong><small>{invitation.job_title || "Sem cargo"} · expira {new Date(invitation.expires_at).toLocaleString("pt-BR")}</small></div><button type="button" className="text-button danger" onClick={() => removeInvitation(invitation.id)}>Cancelar</button></div>)}</div></section>}
    </div>
  );
}
