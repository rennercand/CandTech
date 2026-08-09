"use client";

import { GoogleAnalytics } from "@next/third-parties/google";
import { useEffect, useState } from "react";
import { ANALYTICS_CONSENT_KEY } from "@/lib/analytics";

const analyticsId = process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID || "";

function removeAnalyticsCookies() {
  document.cookie.split(";").forEach((cookie) => {
    const name = cookie.split("=")[0].trim();
    if (!name.startsWith("_ga")) return;
    document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
  });
}

export default function AnalyticsConsent() {
  const [choice, setChoice] = useState("loading");
  const configured = /^G-[A-Z0-9]+$/i.test(analyticsId);

  useEffect(() => {
    setChoice(window.localStorage.getItem(ANALYTICS_CONSENT_KEY) || "unset");
  }, []);

  function choose(nextChoice) {
    window.localStorage.setItem(ANALYTICS_CONSENT_KEY, nextChoice);
    if (nextChoice === "denied") removeAnalyticsCookies();
    setChoice(nextChoice);
  }

  function reopenPreferences() {
    setChoice("unset");
  }

  if (choice === "loading") return null;

  return (
    <>
      {configured && choice === "granted" ? <GoogleAnalytics gaId={analyticsId} /> : null}
      {choice === "unset" ? (
        <aside className="cookie-banner" aria-label="Preferências de cookies">
          <div>
            <strong>Cookies de análise opcionais</strong>
            <p>Usamos o Google Analytics somente com sua autorização para entender visitas e interesse nos planos. Não enviamos dados financeiros nem campos do seu cadastro.</p>
            <a href="/privacidade">Privacidade e cookies</a>
          </div>
          <div className="cookie-actions">
            <button type="button" className="secondary-button" onClick={() => choose("denied")}>Usar só o necessário</button>
            <button type="button" className="primary-button" onClick={() => choose("granted")}>Aceitar análise</button>
          </div>
        </aside>
      ) : (
        <button type="button" className="cookie-preferences" onClick={reopenPreferences}>Cookies</button>
      )}
    </>
  );
}
