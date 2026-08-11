"use client";

import { useEffect, useState } from "react";
import styles from "../auth-flow.module.css";

export default function VerifyEmailPage() {
  const [status, setStatus] = useState("loading"); const [message, setMessage] = useState("Confirmando seu e-mail…");
  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
    window.history.replaceState(null, "", window.location.pathname);
    if (!token) { setStatus("error"); setMessage("O link de confirmação está incompleto."); return; }
    fetch("/api/auth/verify-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "Não foi possível confirmar o e-mail."); setStatus("success"); setMessage(data.message); })
      .catch((error) => { setStatus("error"); setMessage(error.message); });
  }, []);
  return <main className={styles.page}><section className={styles.card}><a className={styles.brand} href="/"><img className="brand-mark" src="/candtech-mark.svg" alt="" /> CandTech</a><p className={styles.eyebrow}>CONFIRMAÇÃO DE E-MAIL</p><h1>{status === "loading" ? "Só um instante" : status === "success" ? "E-mail confirmado" : "Não foi possível confirmar"}</h1><p className={status === "error" ? styles.error : styles.success}>{message}</p><a className={styles.back} href="/">Ir para a CandTech</a></section></main>;
}
