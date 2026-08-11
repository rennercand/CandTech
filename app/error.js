"use client";

import { useEffect } from "react";
import { reportClientBoundary } from "@/lib/observability";

export default function ErrorPage({ error, reset }) {
  useEffect(() => reportClientBoundary(error, "route"), [error]);
  return (
    <main className="recovery-page">
      <section className="recovery-card" role="alert">
        <img className="brand-mark" src="/candtech-mark.svg" alt="CandTech" />
        <p className="eyebrow">NÃO FOI POSSÍVEL CONTINUAR</p>
        <h1>Algo saiu do esperado.</h1>
        <p>Seus dados não foram apagados. Tente carregar esta área novamente ou volte para o início.</p>
        <div><button className="primary-button" onClick={reset}>Tentar novamente</button><a className="secondary-button" href="/">Voltar ao início</a></div>
      </section>
    </main>
  );
}
