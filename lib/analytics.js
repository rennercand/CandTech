"use client";

export const ANALYTICS_CONSENT_KEY = "candtech_analytics_consent_v1";

const ALLOWED_EVENTS = new Set(["generate_lead", "login", "sign_up", "view_subscription"]);
const ALLOWED_PARAMETERS = new Set(["account_type", "method", "source"]);

// Eventos de marketing nunca recebem identificadores, contatos ou dados financeiros.
export function trackMarketingEvent(name, parameters = {}) {
  if (typeof window === "undefined" || !ALLOWED_EVENTS.has(name)) return false;
  if (window.localStorage.getItem(ANALYTICS_CONSENT_KEY) !== "granted") return false;
  if (typeof window.gtag !== "function") return false;

  const safeParameters = Object.fromEntries(
    Object.entries(parameters)
      .filter(([key, value]) => ALLOWED_PARAMETERS.has(key) && ["string", "number", "boolean"].includes(typeof value))
      .map(([key, value]) => [key, typeof value === "string" ? value.slice(0, 80) : value]),
  );
  window.gtag("event", name, safeParameters);
  return true;
}
