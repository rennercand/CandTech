"use client";

import { useEffect, useState } from "react";
import styles from "./page.module.css";

const emptyProfile = {
  accountType: "person", legalName: "", phone: "", postalCode: "",
  address: "", addressNumber: "", complement: "", district: "", city: "", state: "",
  subscriptionStatus: "not_subscriber",
};

const plans = [
  { name: "Pessoal", eyebrow: "ORGANIZAÇÃO", description: "Para controlar decisões, documentos e rotina financeira em um só lugar.", features: ["Calculadoras e relatórios", "Histórico por conta", "Organização financeira"] },
  { name: "Negócio", eyebrow: "OPERAÇÃO", description: "Para organizar financeiro, estoque, pedidos e fornecedores da empresa.", features: ["Tudo do plano Pessoal", "Estoque e logística", "Vendas e compras"] },
  { name: "Empresa", eyebrow: "CONTROLE", description: "Para equipes que precisam de permissões, auditoria e rotinas mais avançadas.", features: ["Tudo do plano Negócio", "Papéis e auditoria", "Integrações futuras"] },
];

export default function SubscribePage() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(emptyProfile);
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
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
    setMessage("Dados de cobrança preparados. Nenhuma cobrança foi realizada.");
  }

  return <main className={styles.page}>
    <nav className={styles.nav}><a href="/" className={styles.brand}><i>CT</i> CandTech</a><a href="/" className={styles.back}>Voltar ao painel</a></nav>
    <header className={styles.hero}>
      <span>ASSINATURAS CANDTECH</span>
      <h1>Escolha o espaço que acompanha sua evolução.</h1>
      <p>Os planos já estão estruturados, mas preços e cobrança ainda não foram ativados. Você pode preparar seu cadastro sem pagar nada.</p>
      <div className={styles.statusPill}>Pagamento ainda não habilitado</div>
    </header>

    <section className={styles.plans} aria-label="Opções futuras de assinatura">
      {plans.map((plan, index) => <article className={styles.planCard} style={{ "--delay": `${index * 180}ms` }} key={plan.name}>
        <span>{plan.eyebrow}</span><h2>{plan.name}</h2><p>{plan.description}</p>
        <ul>{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
        <button type="button" disabled>Disponível em breve</button>
      </article>)}
    </section>

    <section className={styles.billingSection}>
      <div className={styles.billingIntro}>
        <span>DADOS DE COBRANÇA</span><h2>Deixe seu cadastro preparado</h2>
        <p>Guardamos somente nome, contato e endereço. CPF/CNPJ e dados de pagamento só serão solicitados pelo ambiente seguro do provedor se forem realmente necessários para concluir a cobrança ou emitir o documento correspondente.</p>
        <div className={styles.paymentPreview} aria-label="Métodos de pagamento planejados">
          <div><b>PIX</b><small>Planejado</small></div><div><b>Cartão</b><small>Planejado</small></div><div><b>Boleto</b><small>Planejado</small></div>
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
        {message && <p className={message.startsWith("Dados") ? styles.success : styles.error}>{message}</p>}
        <button className={styles.save} disabled={status !== "ready"}>{status === "saving" ? "Salvando…" : "Salvar dados de cobrança"}</button>
        <small className={styles.notice}>Salvar estes dados não cria assinatura, não redireciona para pagamento e não realiza cobrança.</small>
      </form>}
    </section>
  </main>;
}
