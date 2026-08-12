import { reportServerError as writeStructuredLog } from "@/lib/observability";
import { recordMonitoringEvent } from "@/lib/db";

export function reportServerError(error, context = {}) {
  writeStructuredLog(error, context);
  const route = String(context.route || "unknown").slice(0, 120);
  const operation = String(context.operation || "unknown").slice(0, 80);
  const status = Number(context.status || 500);
  const errorName = String(error?.name || "Error").replace(/[^a-z0-9_-]/gi, "").slice(0, 80) || "Error";
  const errorCode = /^[A-Z0-9_]{2,80}$/.test(String(error?.code || "")) ? error.code : "server_operation_failed";
  void recordMonitoringEvent({
    fingerprint: `server:${route}:${operation}:${errorName}:${errorCode}`,
    level: "error",
    source: "server",
    code: errorCode,
    summary: `Falha em ${operation} (${status}).`,
    route,
    details: { status, errorName },
  }).catch(() => null);
}
