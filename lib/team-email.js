function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

export function teamEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.TEAM_INVITE_FROM);
}

export async function sendTeamInvitation({ to, organizationName, inviterName, inviteUrl, invitationId }) {
  if (!teamEmailConfigured()) return { sent: false, reason: "not_configured" };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `team-invitation-${invitationId}`,
    },
    body: JSON.stringify({
      from: process.env.TEAM_INVITE_FROM,
      to: [to],
      subject: `Convite para acessar ${organizationName} na CandTech`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#17152f">
          <h1 style="font-size:24px">Você recebeu um convite</h1>
          <p><strong>${escapeHtml(inviterName)}</strong> convidou você para acessar <strong>${escapeHtml(organizationName)}</strong> na CandTech.</p>
          <p>O acesso é individual e limitado às áreas autorizadas pelo proprietário.</p>
          <p><a href="${escapeHtml(inviteUrl)}" style="display:inline-block;background:#6548e8;color:white;padding:12px 18px;border-radius:8px;text-decoration:none">Aceitar convite</a></p>
          <p style="font-size:12px;color:#6d6982">Este link é de uso único e expira em 72 horas. Não encaminhe este e-mail.</p>
        </div>`,
    }),
  });
  if (!response.ok) {
    console.error(JSON.stringify({ level: "error", message: "team_invitation_email_failed", status: response.status }));
    return { sent: false, reason: "provider_error" };
  }
  return { sent: true };
}
