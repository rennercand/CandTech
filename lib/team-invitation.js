import { createHash } from "node:crypto";
import { TEAM_AREAS } from "./team-permissions.js";

export function validInvitationToken(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{40,60}$/.test(value);
}

export function hashInvitationToken(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

export function maskInvitationEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  const separator = email.lastIndexOf("@");
  if (separator < 1) return "e-mail convidado";
  const local = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  const visible = local.length > 1 ? local.slice(0, 2) : local.slice(0, 1);
  return `${visible}${"*".repeat(Math.max(3, Math.min(8, local.length - visible.length)))}@${domain}`;
}

export function publicInvitationPreview(invitation) {
  return {
    organizationName: invitation.organization_name,
    inviterName: invitation.inviter_name,
    jobTitle: invitation.job_title || "Colaborador",
    permissionLabels: TEAM_AREAS
      .filter((area) => invitation.permissions.includes(area.id))
      .map((area) => area.label),
    maskedEmail: maskInvitationEmail(invitation.email),
    expiresAt: invitation.expires_at,
  };
}
