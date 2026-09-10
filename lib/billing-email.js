function sender() {
  return String(process.env.AUTH_EMAIL_FROM || process.env.TEAM_INVITE_FROM || "").trim();
}

export async function sendAdminAccountBackup({ recipient, attachment, operationKey }) {
  if (!process.env.RESEND_API_KEY || !sender()) return false;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST", signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `admin-backup/${operationKey}` },
    body: JSON.stringify({ from: sender(), to: [recipient], subject: "Exportação dos seus dados CandTech",
      text: "O responsável pela CandTech solicitou esta exportação da sua conta. O ZIP contém dados empresariais e não é cifrado. Guarde em local protegido. Não inclui anexos nem restauração automática da plataforma.",
      attachments: [{ filename: "candtech-dados.zip", content: attachment }] }),
  });
  if (!response.ok) throw new Error("BACKUP_EMAIL_NOT_CONFIRMED");
  return true;
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

// Nome preservado para compatibilidade com o job; envia aviso, nunca dados anexados.
export async function sendPixBackupEmail({ payment }) {
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
      subject: "Exporte os dados da sua conta CandTech",
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#1f1b35"><h1>Seus dados na CandTech</h1><p>Olá, ${safeName}.</p><p>O pagamento Pix de referência <strong>${escapeHtml(payment.txid)}</strong> não foi autorizado dentro do prazo e a assinatura foi suspensa.</p><p>Por segurança, não enviamos dados empresariais anexados. <a href="https://www.candtech.com.br/exportar-dados">Entre na CandTech para solicitar a exportação</a> como proprietário, com MFA. O arquivo reflete os dados no momento do download, não no momento deste aviso.</p><p>Se você já pagou, fale com o suporte para conferência manual. Para exportações maiores ou dificuldade de acesso, solicite atendimento.</p></div>`,
    }),
  });
  if (!response.ok) throw new Error(`Resend recusou o backup (${response.status}).`);
  return { sent: true };
}
