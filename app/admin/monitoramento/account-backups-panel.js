"use client";
import { useEffect, useState } from "react";

export default function AccountBackupsPanel({ activeOnly = false }) {
  const [data, setData] = useState({ accounts: [], next: null });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function load(after = 0) {
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/account-backups?after=${after}&active=${activeOnly ? 1 : 0}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setData(body);
    } catch (error) { setMessage(error.message || "Não foi possível carregar."); }
    finally { setBusy(false); }
  }
  useEffect(() => { load(); }, [activeOnly]);
  async function send(account) {
    if (!window.confirm(`Enviar o ZIP de ${account.company} ao e-mail verificado do titular? O anexo não é cifrado e não pode ser revogado após o envio.`)) return;
    setBusy(true);
    try {
      const response = await fetch("/api/admin/account-backups", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ userId: account.id, confirm: true }) });
      const body = await response.json();
      setMessage(body.message || body.error || "Verifique o resultado do envio.");
    } catch { setMessage("Resultado incerto. Verifique o provedor antes de reenviar."); }
    finally { setBusy(false); }
  }
  return <section className="monitor-panel">
    <h3>{activeOnly ? `Usuários com atividade recente (${data.accounts.length} nesta página)` : "Backups das contas de clientes"}</h3>
    <p>{activeOnly ? "Sessão válida utilizada nos últimos 15 minutos. Não significa presença em tempo real. Até 50 contas por página." : "Somente a conta raiz pode enviar, exclusivamente ao e-mail verificado do titular. Não há destinatário livre. O ZIP não inclui anexos nem restauração completa."}</p>
    <button disabled={busy} onClick={() => load()}>Atualizar / primeira página</button>
    <p role="status">{message}</p>
    <div className="monitor-ticket-list">{data.accounts.map(account => <article className="monitor-ticket" key={account.id}>
      <strong>{account.company}</strong><p>{account.name}</p>
      <span>{account.recentlyActive && account.active ? "Ativo recentemente" : account.active ? "Conta habilitada" : "Conta inativa"}</span>
      {!activeOnly && account.owner && <button disabled={busy || !account.emailVerified} onClick={() => send(account)}>Enviar backup por e-mail</button>}
      {!activeOnly && !account.emailVerified && <p>E-mail não verificado: envio bloqueado.</p>}
    </article>)}</div>
    {!data.accounts.length && <p>Nenhuma conta nesta página.</p>}
    {data.next && <button disabled={busy} onClick={() => load(data.next)}>Próxima página</button>}
  </section>;
}
