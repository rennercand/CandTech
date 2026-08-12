"use client";

import { useEffect } from "react";

function sendClientIncident(payload) {
  void fetch("/api/monitoring/client-error", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, route: window.location.pathname.slice(0, 160) }),
    keepalive: true,
  }).catch(() => null);
}

export default function MonitoringClient() {
  useEffect(() => {
    const onError = (event) => sendClientIncident({
      boundary: "window",
      errorName: String(event.error?.name || "Error").slice(0, 80),
    });
    const onRejection = (event) => sendClientIncident({
      boundary: "unhandled-rejection",
      errorName: String(event.reason?.name || "PromiseRejection").slice(0, 80),
    });
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
