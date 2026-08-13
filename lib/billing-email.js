function sender() {
  return String(process.env.AUTH_EMAIL_FROM || process.env.TEAM_INVITE_FROM || "").trim();
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

export async function sendPixBackupEmail({ payment, attachment }) {
  if (!process.env.RESEND_API_KEY || !sender()) return { sent: false, reason: "not_configured" };
  const safeName = escapeHtml(payment.customer?.name || "cliente");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `pix-backup/${payment.id}`,
    },
    body: JSON.stringify({
      from: sender(),
      to: [payment.customer.email],
      subject: "Backup da sua conta CandTech",
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#1f1b35"><h1>Seu backup da CandTech</h1><p>Olá, ${safeName}.</p><p>O pagamento Pix de referência <strong>${escapeHtml(payment.txid)}</strong> não foi autorizado dentro do prazo e a assinatura foi suspensa.</p><p>O arquivo ZIP anexado contém uma cópia dos dados empresariais disponíveis para sua conta no momento da suspensão. Guarde-o em local seguro.</p><p>Se você já pagou, responda este e-mail ou fale com o suporte para conferência manual.</p></div>`,
      attachments: [{ filename: `candtech-backup-${payment.id}.zip`, content: attachment }],
    }),
  });
  if (!response.ok) throw new Error(`Resend recusou o backup (${response.status}).`);
  return { sent: true };
}
