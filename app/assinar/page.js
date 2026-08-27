"use client";

import { useEffect, useMemo, useState } from "react";
import { upload } from "@vercel/blob/client";
import styles from "./page.module.css";
import { trackMarketingEvent } from "../../lib/analytics";

const emptyProfile = { accountType: "person", legalName: "", phone: "", subscriptionStatus: "not_subscriber", paymentProvider: "" };
const features = ["Financeiro, estoque e pedidos", "Equipe com cargos e permissões", "Importação e exportação de planilhas", "Histórico e relatórios"];
const acceptedReceipts = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const receiptExtension = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export default function SubscribePage() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(emptyProfile);
  const [payment, setPayment] = useState(null);
  const [contact, setContact] = useState(null);
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("");
  const [selectedReceipt, setSelectedReceipt] = useState(null);

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

  async function uploadReceipt() {
    if (!payment?.id || !selectedReceipt) return;
    if (!acceptedReceipts.includes(selectedReceipt.type)) return setMessage("Envie um comprovante PDF, JPG, PNG ou WEBP.");
    if (selectedReceipt.size > 5 * 1024 * 1024) return setMessage("O comprovante deve ter no máximo 5 MB.");
    setStatus("uploading"); setMessage("");
    try {
      if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
        const response = await fetch(`/api/pix/${payment.id}/receipt`, {
          method: "POST", headers: { "Content-Type": selectedReceipt.type, "X-File-Name": encodeURIComponent(selectedReceipt.name) }, body: selectedReceipt,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Não foi possível enviar o comprovante.");
        setPayment(data.payment);
        setMessage(data.duplicate ? "Este comprovante já estava enviado." : "Comprovante enviado. O pagamento está aguardando conferência da equipe CandTech.");
      } else {
        await upload(`pix-receipts/${crypto.randomUUID()}.${receiptExtension[selectedReceipt.type]}`, selectedReceipt, {
          access: "private", handleUploadUrl: `/api/pix/${payment.id}/receipt`, contentType: selectedReceipt.type,
          clientPayload: JSON.stringify({ originalFilename: selectedReceipt.name }),
        });
        let updated = null;
        for (let attempt = 0; attempt < 12 && !updated?.receipt; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          const response = await fetch("/api/pix", { cache: "no-store" });
          if (response.ok) updated = (await response.json()).payment;
        }
        if (updated) setPayment(updated);
        setMessage(updated?.receipt ? "Comprovante enviado. O pagamento está aguardando conferência da equipe CandTech."
          : "Comprovante recebido e em processamento. Atualize esta página em alguns segundos para acompanhar.");
      }
      setSelectedReceipt(null);
    } catch (error) { setMessage(error.message); } finally { setStatus("ready"); }
  }

  const active = profile.subscriptionStatus === "active" || user?.subscriptionStatus === "active";
  return <main className={styles.page}>
    <nav className={styles.nav}><a href="/" className={styles.brand}><img className="brand-mark" src="/candtech-mark.svg" alt=""/> CandTech</a><a href="/" className={styles.back}>Voltar ao painel</a></nav>
    <header className={styles.hero}><span>ASSINATURA POR PIX</span><h1>Um preço simples para organizar sua empresa.</h1><p>O Pix é gerado pela CandTech e conferido manualmente. Nenhum dado bancário, senha ou cartão é armazenado no sistema.</p><div className={styles.statusPill}>{active ? "Assinatura ativa" : payment?.status === "payment_review" ? "Comprovante em conferência" : payment?.status === "pending" ? "Pix aguardando pagamento" : "Pagamento por Pix"}</div></header>
    <section className={styles.plans} style={{ maxWidth: "460px", gridTemplateColumns: "1fr" }} aria-label="Plano de assinatura"><article className={styles.planCard} style={{ "--delay": "0ms" }}><span>PLANO ÚNICO</span><h2>CandTech Negócio</h2><strong className={styles.planPrice}>R$ 60/mês</strong><small className={styles.setupPrice}>+ R$ 120 de implantação apenas no primeiro Pix</small><p>Preço fixo por empresa, sem cobrança adicional por funcionário convidado.</p><ul>{features.map((feature) => <li key={feature}>{feature}</li>)}</ul></article></section>
    <section className={styles.billingSection}>
      <div className={styles.billingIntro}><span>PIX SEGURO</span><h2>Pagamento com conferência humana</h2><p>Ao gerar o código, uma solicitação aparece na central administrativa. O acesso só é liberado depois que o recebimento é confirmado.</p><div className={styles.paymentPreview}><div><b>1. Gere</b><small>Copia e Cola</small></div><div><b>2. Pague</b><small>No seu banco</small></div><div><b>3. Envie</b><small>O comprovante</small></div></div></div>
      {!user && status === "ready" ? <div className={styles.signInCard}><span>PRIMEIRO PASSO</span><h3>Entre para gerar seu Pix</h3><p>A cobrança ficará vinculada somente à empresa autenticada.</p><a href="/?cadastro=1">Criar minha conta</a><small>Já tem conta? <a href="/?entrar=1">Entrar</a></small></div> : <div className={styles.form}>
        <form className={styles.profileForm} onSubmit={saveProfile}><div className={styles.typeToggle}><button type="button" className={profile.accountType === "person" ? styles.active : ""} onClick={() => update("accountType", "person")}>Pessoa física</button><button type="button" className={profile.accountType === "company" ? styles.active : ""} onClick={() => update("accountType", "company")}>Empresa</button></div><label>{profile.accountType === "person" ? "Nome completo" : "Razão social"}<input required maxLength="120" value={profile.legalName} onChange={(event) => update("legalName", event.target.value)}/></label><label>Telefone para contato<input value={profile.phone} onChange={(event) => update("phone", event.target.value)}/></label><button className={styles.save} disabled={status !== "ready"}>{status === "saving" ? "Salvando…" : "Salvar contato"}</button></form>
        {!active && payment?.status === "pending" && payment.pixCode ? <div className={styles.pixBox}><span>1. PIX COPIA E COLA</span><strong>{payment.amount}</strong><small>Referência {payment.txid} · válido até {new Date(payment.dueAt).toLocaleString("pt-BR")}</small><textarea readOnly rows="5" value={payment.pixCode} aria-label="Código Pix Copia e Cola"/><button type="button" className={styles.save} onClick={copyPix}>Copiar código Pix</button><div className={styles.receiptUpload}><strong>2. Envie o comprovante</strong><p>Preferencialmente PDF. Também aceitamos JPG, PNG ou WEBP de até 5 MB.</p><label className={styles.filePicker}><input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setSelectedReceipt(event.target.files?.[0] || null)}/><span>{selectedReceipt ? selectedReceipt.name : "Selecionar comprovante"}</span></label><button type="button" className={styles.save} disabled={!selectedReceipt || status !== "ready"} onClick={uploadReceipt}>{status === "uploading" ? "Enviando…" : "Enviar comprovante"}</button><small className={styles.notice}>O envio não confirma o pagamento. A liberação ocorre somente após conferência pelo suporte.</small></div>{whatsappUrl && <a className={styles.whatsapp} href={whatsappUrl} target="_blank" rel="noreferrer">Preciso falar com o suporte</a>}</div> : !active && payment?.status === "payment_review" ? <div className={styles.reviewBox}><span>COMPROVANTE RECEBIDO</span><strong>Pagamento aguardando conferência</strong><p>{payment.receipt?.originalFilename || "Comprovante enviado"} · enviado em {payment.receipt?.uploadedAt ? new Date(payment.receipt.uploadedAt).toLocaleString("pt-BR") : "agora"}.</p><small>A assinatura ainda não está ativa. A equipe CandTech confirmará o recebimento na conta antes da liberação.</small><label className={styles.filePicker}><input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setSelectedReceipt(event.target.files?.[0] || null)}/><span>{selectedReceipt ? selectedReceipt.name : "Substituir comprovante"}</span></label><button type="button" className={styles.save} disabled={!selectedReceipt || status !== "ready"} onClick={uploadReceipt}>{status === "uploading" ? "Enviando…" : "Enviar substituição"}</button></div> : !active && <button type="button" className={styles.save} disabled={status !== "ready" || !user} onClick={generatePix}>{status === "generating" ? "Gerando…" : "Gerar Pix"}</button>}
        {active && <p className={styles.success}>Pagamento confirmado. Sua empresa está com acesso ativo.</p>}{message && <p className={message.startsWith("Não") || message.includes("configurado") ? styles.error : styles.success}>{message}</p>}
      </div>}
    </section>
  </main>;
}
