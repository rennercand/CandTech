"use client";

import { useEffect, useState } from "react";
import styles from "./page.module.css";
import { trackMarketingEvent } from "../../lib/analytics";

const emptyProfile = {
  accountType: "person", legalName: "", phone: "", postalCode: "",
  address: "", addressNumber: "", complement: "", district: "", city: "", state: "",
  subscriptionStatus: "not_subscriber",
  paymentProvider: "",
};

const plans = [
  {
    name: "CandTech Negócio", eyebrow: "PLANO ÚNICO", monthlyPrice: "R$ 60/mês",
    setupPrice: "+ R$ 120 de implantação na primeira cobrança",
    description: "Preço fixo por empresa, sem cobrança adicional por funcionário convidado.",
    features: ["Financeiro, estoque e pedidos", "Equipe com cargos e permissões", "Importação e exportação de planilhas", "Histórico e relatórios"],
  },
];

export default function SubscribePage() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(emptyProfile);
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    trackMarketingEvent("view_subscription", { source: "subscription_page" });
    const checkoutResult = new URLSearchParams(window.location.search).get("checkout");
    if (checkoutResult === "success") setMessage("Checkout concluído. O acesso será atualizado após a confirmação assinada da Stripe.");
    if (checkoutResult === "cancelled") setMessage("Checkout cancelado. Nenhuma nova assinatura foi criada.");
    Promise.all([
      fetch("/api/auth/me", { cache: "no-store" }),
      fetch("/api/profile", { cache: "no-store" }),
    ]).then(async ([sessionResponse, profileResponse]) => {
      if (sessionResponse.ok) setUser((await sessionResponse.json()).user);
      if (profileResponse.ok) setProfile({ ...emptyProfile, ...(await profileResponse.json()).profile });
      setStatus("ready");
    }).catch(() => setStatus("ready"));
  }, []);

  const update = (field, value) => setProfile((current) => ({ ...current, [field]: value }));
  async function saveProfile(event) {
    event.preventDefault();
    setStatus("saving");
    setMessage("");
    const response = await fetch("/api/profile", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profile),
    });
    const data = await response.json();
    setStatus("ready");
    if (!response.ok) return setMessage(data.error || "Não foi possível salvar os dados.");
    setProfile({ ...emptyProfile, ...data.profile });
    trackMarketingEvent("generate_lead", { source: "billing_profile", account_type: data.profile?.accountType || profile.accountType });
    setMessage("Dados de cobrança preparados. Nenhuma cobrança foi realizada.");
  }
  async function openStripe(path) {
    setStatus("redirecting"); setMessage("");
    try {
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await response.json();
      if (!response.ok || !data.url) throw new Error(data.error || "Não foi possível abrir a Stripe.");
      window.location.assign(data.url);
    } catch (error) {
      setMessage(error.message); setStatus("ready");
    }
  }

  return <main className={styles.page}>
    <nav className={styles.nav}><a href="/" className={styles.brand}><img className="brand-mark" src="/candtech-mark.svg" alt="" /> CandTech</a><a href="/" className={styles.back}>Voltar ao painel</a></nav>
    <header className={styles.hero}>
      <span>ASSINATURAS CANDTECH</span>
      <h1>Um preço simples para organizar sua empresa.</h1>
      <p>Assinatura mensal fixa, com implantação cobrada apenas na primeira contratação. O pagamento acontece no Checkout hospedado da Stripe.</p>
      <div className={styles.statusPill}>{profile.subscriptionStatus === "active" ? "Assinatura ativa" : "Stripe em configuração"}</div>
    </header>

    <section className={styles.plans} style={{ maxWidth: "460px", gridTemplateColumns: "1fr" }} aria-label="Plano de assinatura">
      {plans.map((plan, index) => <article className={styles.planCard} style={{ "--delay": `${index * 180}ms` }} key={plan.name}>
        <span>{plan.eyebrow}</span><h2>{plan.name}</h2>
        <strong style={{ display: "block", color: "#241b55", fontSize: "34px", letterSpacing: "-.04em" }}>{plan.monthlyPrice}</strong>
        <small style={{ display: "block", margin: "6px 0 18px", color: "#6b54df", fontWeight: 800 }}>{plan.setupPrice}</small><p>{plan.description}</p>
        <ul>{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
        <button type="button" disabled>Contratação pelo checkout seguro abaixo</button>
      </article>)}
    </section>

    <section className={styles.billingSection}>
      <div className={styles.billingIntro}>
        <span>DADOS DE COBRANÇA</span><h2>Deixe seu cadastro preparado</h2>
        <p>Guardamos somente nome, contato, endereço e o status da assinatura. Os dados de pagamento são informados diretamente no ambiente da Stripe.</p>
        <div className={styles.paymentPreview} aria-label="Proteções do pagamento">
          <div><b>Checkout</b><small>Hospedado</small></div><div><b>Cartão</b><small>Na Stripe</small></div><div><b>Portal</b><small>Cancelamento</small></div>
        </div>
      </div>
      {!user && status === "ready" ? <div className={styles.signInCard}>
        <span>PRIMEIRO PASSO</span><h3>Crie sua conta para preparar o cadastro</h3><p>Você poderá escolher pessoa física ou empresa durante o registro.</p><a href="/?cadastro=1">Criar minha conta</a><small>Já tem conta? <a href="/">Entrar</a></small>
      </div> : <form className={styles.form} onSubmit={saveProfile}>
        <div className={styles.typeToggle}>
          <button type="button" className={profile.accountType === "person" ? styles.active : ""} onClick={() => update("accountType", "person")}>Pessoa física</button>
          <button type="button" className={profile.accountType === "company" ? styles.active : ""} onClick={() => update("accountType", "company")}>Empresa</button>
        </div>
        <label>{profile.accountType === "person" ? "Nome completo" : "Razão social"}<input required maxLength="120" value={profile.legalName} onChange={(e) => update("legalName", e.target.value)} /></label>
        <div className={styles.twoColumns}><label>Telefone<input value={profile.phone} onChange={(e) => update("phone", e.target.value)} /></label><label>CEP<input inputMode="numeric" value={profile.postalCode} onChange={(e) => update("postalCode", e.target.value)} /></label></div>
        <label>Endereço<input value={profile.address} onChange={(e) => update("address", e.target.value)} /></label>
        <div className={styles.threeColumns}><label>Número<input value={profile.addressNumber} onChange={(e) => update("addressNumber", e.target.value)} /></label><label>Bairro<input value={profile.district} onChange={(e) => update("district", e.target.value)} /></label><label>Complemento<input value={profile.complement} onChange={(e) => update("complement", e.target.value)} /></label></div>
        <div className={styles.twoColumns}><label>Cidade<input value={profile.city} onChange={(e) => update("city", e.target.value)} /></label><label>UF<input maxLength="2" value={profile.state} onChange={(e) => update("state", e.target.value.toUpperCase())} /></label></div>
        {message && <p className={message.startsWith("Dados") || message.startsWith("Checkout concluído") ? styles.success : styles.error}>{message}</p>}
        <button className={styles.save} disabled={status !== "ready"}>{status === "saving" ? "Salvando…" : "Salvar dados de cobrança"}</button>
        {profile.paymentProvider === "stripe" && profile.subscriptionStatus !== "not_subscriber"
          ? <button type="button" className={styles.save} disabled={status !== "ready"} onClick={() => openStripe("/api/stripe/portal")}>Gerenciar assinatura na Stripe</button>
          : <button type="button" className={styles.save} disabled={status !== "ready"} onClick={() => openStripe("/api/stripe/checkout")}>{status === "redirecting" ? "Abrindo Stripe…" : "Continuar para checkout seguro"}</button>}
        <small className={styles.notice}>Salvar o cadastro não cobra nada. O checkout mostra o preço e a periodicidade antes da confirmação, e o retorno do navegador nunca libera acesso sozinho.</small>
      </form>}
    </section>
  </main>;
}
