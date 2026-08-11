"use client";

import { useEffect, useState } from "react";
import styles from "../auth-flow.module.css";

export default function ResetPasswordPage() {
  const [token, setToken] = useState(""); const [password, setPassword] = useState(""); const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState("idle"); const [message, setMessage] = useState("");
  useEffect(() => { setToken(new URLSearchParams(window.location.hash.slice(1)).get("token") || ""); window.history.replaceState(null, "", window.location.pathname); }, []);
  async function submit(event) {
    event.preventDefault(); setMessage("");
    if (password !== confirm) { setStatus("error"); setMessage("As senhas não coincidem."); return; }
    setStatus("loading");
    try {
      const response = await fetch("/api/auth/reset-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Não foi possível redefinir a senha.");
      setStatus("success"); setMessage(data.message);
    } catch (error) { setStatus("error"); setMessage(error.message); }
  }
  const missing = status === "idle" && !token;
  return <main className={styles.page}><section className={styles.card}>
    <a className={styles.brand} href="/"><i>CT</i> CandTech</a><p className={styles.eyebrow}>NOVA SENHA</p><h1>Defina uma nova senha</h1>
    <p className={styles.intro}>Depois da alteração, todas as sessões antigas serão encerradas para proteger sua conta.</p>
    {missing && <p className={styles.error}>O link está incompleto. Solicite uma nova recuperação.</p>}
    {message && <p className={status === "success" ? styles.success : styles.error}>{message}</p>}
    {!missing && status !== "success" && <form className={styles.form} onSubmit={submit}><label>Nova senha<input required type="password" autoComplete="new-password" minLength="8" maxLength="128" value={password} onChange={(event) => setPassword(event.target.value)} /><small>Mínimo de 8 caracteres. Uma frase longa é mais segura e fácil de lembrar.</small></label><label>Repita a nova senha<input required type="password" autoComplete="new-password" minLength="8" maxLength="128" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label><button className={styles.button} disabled={status === "loading"}>{status === "loading" ? "Salvando…" : "Salvar nova senha"}</button></form>}
    <a className={styles.back} href={status === "success" ? "/" : "/esqueci-senha"}>{status === "success" ? "Entrar com a nova senha" : "Solicitar outro link"}</a>
  </section></main>;
}
