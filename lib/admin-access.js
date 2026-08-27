import { createHmac, timingSafeEqual } from "node:crypto";
import { getStaffAccessByUserId } from "./staff-db.js";

export function isAdministrator(email) {
  const allowed = String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(String(email || "").trim().toLowerCase());
}

// ADMIN_EMAILS é a raiz de confiança e não pode ser alterada pela interface.
// As demais contas recebem somente os módulos explicitamente concedidos.
export async function getAdministratorAccess(user) {
  if (!user?.id || !user?.email) return { isStaff: false, isRoot: false, canMonitor: false, canSupport: false, canBilling: false, canManageStaff: false };
  if (isAdministrator(user.email)) {
    return { isStaff: true, isRoot: true, canMonitor: true, canSupport: true, canBilling: true, canManageStaff: true };
  }
  const granted = await getStaffAccessByUserId(user.id);
  const access = {
    isRoot: false,
    canMonitor: Boolean(granted?.canMonitor),
    canSupport: Boolean(granted?.canSupport),
    canBilling: Boolean(granted?.canBilling),
    canManageStaff: false,
  };
  return { ...access, isStaff: access.canMonitor || access.canSupport || access.canBilling };
}

function monitoringAccessKey() {
  const configured = String(process.env.ADMIN_MONITORING_SLUG || "").trim();
  if (/^[a-zA-Z0-9_-]{24,80}$/.test(configured)) return configured;
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET não configurado");
  // O endereço muda junto com o segredo da aplicação e nunca é gravado no código.
  return createHmac("sha256", process.env.JWT_SECRET)
    .update("candtech-private-monitoring-v1")
    .digest("base64url")
    .slice(0, 32);
}

export function getMonitoringAccessPath() {
  return `/central/${monitoringAccessKey()}`;
}

export function isMonitoringAccessKey(value) {
  const expected = Buffer.from(monitoringAccessKey());
  const received = Buffer.from(String(value || ""));
  return expected.length === received.length && timingSafeEqual(expected, received);
}
