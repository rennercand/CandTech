"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";
import { trackMarketingEvent } from "../../lib/analytics";

const emptyProfile = { accountType: "person", legalName: "", phone: "", subscriptionStatus: "not_subscriber", paymentProvider: "" };
const features = ["Financeiro, estoque e pedidos", "Equipe com cargos e permissões", "Importação e exportação de planilhas", "Histórico e relatórios"];

export default function SubscribePage() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(emptyProfile);
  const [payment, setPayment] = useState(null);
  const [contact, setContact] = useState(null);
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    trackMarketingEvent("view_subscription", { source: "subscription_page" });
    Promise.all([fetch("/api/auth/me", { cache: "no-store" }), fetch("/api/profile", { cache: "no-store" })])
      .then(async ([sessionResponse, profileResponse]) => {
        const session = sessionResponse.ok ? (await sessionResponse.json()).user : null;
        if (session) {
          setUser(session);
          const pixResponse = await fetch("/api/pix", { cache: "no-store" });
          if (pixResponse.ok) { const pix = await pixResponse.json(); setPayment(pix.payment); setContact(pix.contact); }
        }
        if (profileResponse.ok) setProfile({ ...emptyProfile, ...(await profileResponse.json()).profile });
        setStatus("ready");
      }).catch(() => setStatus("ready"));
  }, []);

  const whatsappUrl = useMemo(() => {
    if (!contact?.whatsapp || !payment) return "";
    return `https://wa.me/${contact.whatsapp}?text=${encodeURIComponent(`Olá, realizei o Pix da CandTech. Referência: ${payment.txid}. Valor: ${payment.amount}.`)}`;
  }, [contact, payment]);
  const update = (field, value) => setProfile((current) => ({ ...current, [field]: value }));

  async function saveProfile(event) {
    event.preventDefault(); setStatus("saving"); setMessage("");
    const response = await fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profile) });
    const data = await response.json(); setStatus("ready");
    if (!response.ok) return setMessage(data.error || "Não foi possível salvar os dados.");
    setProfile({ ...emptyProfile, ...data.profile }); setMessage("Cadastro salvo. Agora você pode gerar o Pix.");
  }

  async function generatePix() {
    setStatus("generating"); setMessage("");
    try {
      const response = await fetch("/api/pix", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível gerar o Pix.");
      setPayment(data.payment); setContact(data.contact);
      setMessage(data.created ? "Pix gerado e aviso enviado à central da CandTech." : "Você já possui um Pix aguardando confirmação.");
    } catch (error) { setMessage(error.message); } finally { setStatus("ready"); }
  }

  async function copyPix() {
    await navigator.clipboard.writeText(payment.pixCode);
    setMessage("Código Pix copiado. Após pagar, avise pelo WhatsApp ou acompanhe a confirmação nesta página.");
  }

  const active = profile.subscriptionStatus === "active" || user?.subscriptionStatus === "active";
  return <main className={styles.page}>
    <nav className={styles.nav}><a href="/" className={styles.brand}><img className="brand-mark" src="/candtech-mark.svg" alt=""/> CandTech</a><a href="/" className={styles.back}>Voltar ao painel</a></nav>
    <header className={styles.hero}><span>ASSINATURA POR PIX</span><h1>Um preço simples para organizar sua empresa.</h1><p>O Pix é gerado pela CandTech e conferido manualmente. Nenhum dado bancário, senha ou cartão é armazenado no sistema.</p><div className={styles.statusPill}>{active ? "Assinatura ativa" : payment?.status === "pending" ? "Pix aguardando conferência" : "Pagamento por Pix"}</div></header>
    <section className={styles.plans} style={{ maxWidth: "460px", gridTemplateColumns: "1fr" }} aria-label="Plano de assinatura"><article className={styles.planCard} style={{ "--delay": "0ms" }}><span>PLANO ÚNICO</span><h2>CandTech Negócio</h2><strong className={styles.planPrice}>R$ 60/mês</strong><small className={styles.setupPrice}>+ R$ 120 de implantação apenas no primeiro Pix</small><p>Preço fixo por empresa, sem cobrança adicional por funcionário convidado.</p><ul>{features.map((feature) => <li key={feature}>{feature}</li>)}</ul></article></section>
    <section className={styles.billingSection}>
      <div className={styles.billingIntro}><span>PIX SEGURO</span><h2>Pagamento com conferência humana</h2><p>Ao gerar o código, uma solicitação aparece na central administrativa. O acesso só é liberado depois que o recebimento é confirmado.</p><div className={styles.paymentPreview}><div><b>1. Gere</b><small>Copia e Cola</small></div><div><b>2. Pague</b><small>No seu banco</small></div><div><b>3. Avise</b><small>Site ou WhatsApp</small></div></div></div>
      {!user && status === "ready" ? <div className={styles.signInCard}><span>PRIMEIRO PASSO</span><h3>Entre para gerar seu Pix</h3><p>A cobrança ficará vinculada somente à empresa autenticada.</p><a href="/?cadastro=1">Criar minha conta</a><small>Já tem conta? <a href="/?entrar=1">Entrar</a></small></div> : <div className={styles.form}>
        <form className={styles.profileForm} onSubmit={saveProfile}><div className={styles.typeToggle}><button type="button" className={profile.accountType === "person" ? styles.active : ""} onClick={() => update("accountType", "person")}>Pessoa física</button><button type="button" className={profile.accountType === "company" ? styles.active : ""} onClick={() => update("accountType", "company")}>Empresa</button></div><label>{profile.accountType === "person" ? "Nome completo" : "Razão social"}<input required maxLength="120" value={profile.legalName} onChange={(event) => update("legalName", event.target.value)}/></label><label>Telefone para contato<input value={profile.phone} onChange={(event) => update("phone", event.target.value)}/></label><button className={styles.save} disabled={status !== "ready"}>{status === "saving" ? "Salvando…" : "Salvar contato"}</button></form>
        {!active && payment?.status === "pending" && payment.pixCode ? <div className={styles.pixBox}><span>PIX COPIA E COLA</span><strong>{payment.amount}</strong><small>Referência {payment.txid} · válido até {new Date(payment.dueAt).toLocaleString("pt-BR")}</small><textarea readOnly rows="5" value={payment.pixCode} aria-label="Código Pix Copia e Cola"/><button type="button" className={styles.save} onClick={copyPix}>Copiar código Pix</button>{whatsappUrl && <a className={styles.whatsapp} href={whatsappUrl} target="_blank" rel="noreferrer">Avisar pagamento pelo WhatsApp</a>}<small className={styles.notice}>A solicitação também já foi enviada para a central interna. A tela sozinha não aprova o pagamento.</small></div> : !active && <button type="button" className={styles.save} disabled={status !== "ready" || !user} onClick={generatePix}>{status === "generating" ? "Gerando…" : "Gerar Pix"}</button>}
        {active && <p className={styles.success}>Pagamento confirmado. Sua empresa está com acesso ativo.</p>}{message && <p className={message.startsWith("Não") || message.includes("configurado") ? styles.error : styles.success}>{message}</p>}
      </div>}
    </section>
  </main>;
}
