"use client";

import { useEffect } from "react";
import { reportClientBoundary } from "@/lib/observability";

export default function GlobalError({ error, reset }) {
  useEffect(() => reportClientBoundary(error, "global"), [error]);
  return (
    <html lang="pt-BR">
      <body>
        <main className="recovery-page">
          <section className="recovery-card" role="alert">
            <span>CT</span>
            <h1>A CandTech encontrou uma falha inesperada.</h1>
            <p>Tente abrir o sistema novamente. Se a falha continuar, informe o horário ao suporte.</p>
            <div><button onClick={reset}>Tentar novamente</button><a href="/">Reabrir a CandTech</a></div>
          </section>
        </main>
      </body>
    </html>
  );
}
