"use client";

import { useEffect, useState } from "react";
import { SUBSCRIPTION_PRICING } from "../../lib/subscription-pricing";
import { publicSupportContact } from "../../lib/support-contact";
import { trackMarketingEvent } from "../../lib/analytics";
import styles from "./page.module.css";

const features = ["Financeiro, estoque e pedidos", "Equipe com cargos e permissões", "Importação e exportação de planilhas", "Histórico e relatórios"];

export default function SubscribePage() {
  const [user, setUser] = useState(null);
  const [payment, setPayment] = useState(null);
  const [contact, setContact] = useState(publicSupportContact);
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        trackMarketingEvent("view_subscription", { source: "subscription_page" });
        const response = await fetch("/api/auth/me", { cache: "no-store" });
        const session = response.ok ? (await response.json()).user : null;
        if (cancelled) return;
        setUser(session);
        if (session?.isBillingOwner) {
          const paymentResponse = await fetch("/api/pix", { cache: "no-store" });
          if (!paymentResponse.ok) throw new Error("Não foi possível consultar sua solicitação. Entre em contato com o suporte.");
          const data = await paymentResponse.json();
          if (!cancelled) {
            setPayment(data.payment);
            if (data.contact) setContact(data.contact);
          }
        }
      } catch (failure) {
        if (!cancelled) setError(failure.message || "Não foi possível consultar sua conta. Entre em contato com o suporte.");
      } finally {
        if (!cancelled) setStatus("ready");
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  async function requestPayment() {
    setStatus("requesting"); setMessage(""); setError("");
    try {
      const response = await fetch("/api/pix", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível registrar a solicitação.");
      setPayment(data.payment);
      if (data.contact) setContact(data.contact);
      setMessage(data.created ? "Solicitação registrada. Fale com o suporte abaixo para receber as orientações de pagamento." : "Sua solicitação já está registrada. Fale com o suporte abaixo para continuar.");
    } catch (failure) {
      setError(failure.message || "Não foi possível registrar a solicitação. Fale com o suporte abaixo.");
    } finally { setStatus("ready"); }
  }

  const active = user?.subscriptionStatus === "active";
  const pending = payment && ["pending", "payment_review"].includes(payment.status);
  const supportMessage = pending
    ? `Olá! Quero orientações para efetuar o pagamento da CandTech. Referência: ${payment.txid}. Valor: ${payment.amount}.`
    : "Olá! Quero orientações para contratar ou renovar a CandTech e efetuar o pagamento pelo suporte.";
  const whatsappUrl = contact?.whatsapp ? `https://wa.me/${contact.whatsapp}?text=${encodeURIComponent(supportMessage)}` : "";
  const emailUrl = contact?.email ? `mailto:${contact.email}?subject=${encodeURIComponent("Pagamento da assinatura CandTech")}&body=${encodeURIComponent(supportMessage)}` : "";

  return <main className={styles.page}>
    <nav className={styles.nav}><a href="/" className={styles.brand}><img className="brand-mark" src="/candtech-mark.svg" alt=""/> CandTech</a><a href="/" className={styles.back}>Voltar ao painel</a></nav>
    <header className={styles.hero}>
      <span>ASSINATURA CANDTECH</span>
      <h1>Um preço simples para organizar sua empresa.</h1>
      <p>Para efetuar o pagamento, entre em contato com o suporte. Nossa equipe orienta a contratação e confirma o recebimento antes de liberar o acesso.</p>
      <div className={styles.statusPill}>{active ? "Assinatura ativa" : pending ? "Solicitação em atendimento" : "Pagamento pelo suporte"}</div>
    </header>
    <section className={styles.plans} style={{ maxWidth: "460px", gridTemplateColumns: "1fr" }} aria-label="Plano de assinatura">
      <article className={styles.planCard} style={{ "--delay": "0ms" }}>
        <span>PLANO ÚNICO</span><h2>CandTech Negócio</h2>
        <strong className={styles.planPrice}>R$ {SUBSCRIPTION_PRICING.firstMonth / 100} no primeiro mês</strong>
        <small className={styles.setupPrice}>R$ {SUBSCRIPTION_PRICING.monthly / 100}/mês a partir do segundo mês, sem taxa adicional</small>
        <p>Preço fixo por empresa, sem cobrança adicional por funcionário convidado.</p>
        <ul>{features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
        <a className={styles.save} href="#pagamento">Falar com o suporte para pagar</a>
      </article>
    </section>
    <section className={styles.billingSection} id="pagamento">
      <div className={styles.billingIntro}>
        <span>ATENDIMENTO PARA PAGAMENTO</span><h2>Fale com a equipe CandTech</h2>
        <p>Informe o e-mail da sua conta e, se já tiver uma solicitação, a referência mostrada nesta página. A equipe vai orientar como efetuar o pagamento.</p>
        <div className={styles.paymentPreview}><div><b>1. Contato</b><small>Fale com o suporte</small></div><div><b>2. Orientação</b><small>Combine o pagamento</small></div><div><b>3. Liberação</b><small>Após conferência</small></div></div>
      </div>
      <div className={styles.form}>
        {status === "loading" ? <p role="status">Consultando sua conta…</p> : user ? <>
          <div className={styles.identityCard}><span>SUA CONTA</span><strong>{user.name}</strong><small>{user.email}</small><p>Somente nome e e-mail da conta identificam sua solicitação na central.</p></div>
          {active && <p className={styles.success}>Sua assinatura está ativa. Para renovar, fale com o suporte.</p>}
          {pending && <div className={styles.reviewBox}><span>SOLICITAÇÃO REGISTRADA</span><strong>{payment.amount}</strong><small>Referência: {payment.txid}</small><p>O suporte confirmará o valor e o recebimento antes da liberação. Se você já pagou, avise a equipe antes de efetuar outro pagamento.</p></div>}
          {!active && user.isBillingOwner && !pending && <button type="button" className={styles.save} disabled={status !== "ready"} onClick={requestPayment}>{status === "requesting" ? "Registrando…" : "Registrar solicitação de pagamento"}</button>}
          {!user.isBillingOwner && <p className={styles.notice}>A contratação ou renovação deve ser solicitada pelo proprietário da conta.</p>}
        </> : <div className={styles.signInCard}><span>PRIMEIRO PASSO</span><h3>Entre para identificar sua assinatura</h3><p>Você também pode falar com o suporte antes de criar sua conta.</p><a href="/?cadastro=1">Criar minha conta</a><small>Já tem conta? <a href="/?entrar=1">Entrar</a></small></div>}
        {message && <p className={styles.success} role="status">{message}</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        {whatsappUrl && <a className={styles.whatsapp} href={whatsappUrl} target="_blank" rel="noopener noreferrer">Falar com o suporte pelo WhatsApp</a>}
        {emailUrl && <a className={styles.save} href={emailUrl}>Falar com o suporte por e-mail</a>}
        <small className={styles.notice}>Entrar em contato ou registrar uma solicitação não confirma o pagamento nem libera o acesso. A liberação depende da conferência manual da equipe.</small>
      </div>
    </section>
  </main>;
}
