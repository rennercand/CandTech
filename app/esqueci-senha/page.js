"use client";

import { useState } from "react";
import styles from "../auth-flow.module.css";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");
  async function submit(event) {
    event.preventDefault(); setStatus("loading"); setMessage("");
    try {
      const response = await fetch("/api/auth/forgot-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível solicitar a recuperação.");
      setStatus("success"); setMessage(data.message);
    } catch (error) { setStatus("error"); setMessage(error.message); }
  }
  return <main className={styles.page}><section className={styles.card}>
    <a className={styles.brand} href="/"><i>CT</i> CandTech</a>
    <p className={styles.eyebrow}>RECUPERAÇÃO DE ACESSO</p><h1>Esqueceu sua senha?</h1>
    <p className={styles.intro}>Informe o e-mail da conta. Se ele estiver cadastrado, enviaremos um link seguro válido por 30 minutos.</p>
    {message && <p className={status === "success" ? styles.success : styles.error}>{message}</p>}
    {status !== "success" && <form className={styles.form} onSubmit={submit}><label>E-mail<input required type="email" autoComplete="email" maxLength="254" value={email} onChange={(event) => setEmail(event.target.value)} /></label><button className={styles.button} disabled={status === "loading"}>{status === "loading" ? "Enviando…" : "Enviar link de recuperação"}</button></form>}
    <a className={styles.back} href="/">Voltar para o login</a>
  </section></main>;
}
