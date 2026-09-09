import { appendAuditEvent } from "./db.js";
import { sendPixBackupEmail } from "./billing-email.js";
import { expirePixPayments, listPixPaymentsAwaitingBackup, markPixBackupSent } from "./pix-db.js";
import { reportServerError } from "./server-observability.js";

export async function processPixExpirations() {
  const expired = await expirePixPayments();
  const awaitingBackup = await listPixPaymentsAwaitingBackup();
  let backupsSent = 0;
  for (const payment of awaitingBackup) {
    try {
      const delivery = await sendPixBackupEmail({ payment });
      if (!delivery.sent) continue;
      await markPixBackupSent(payment.id);
      await appendAuditEvent({
        userId: payment.userId,
        actorUserId: null,
        action: "subscription.export_notice_sent",
        origin: "system/pix-expiration",
        subjectType: "pix_payment_request",
        subjectId: payment.id,
        newState: { exportNoticeSent: true },
        metadata: { provider: "pix", delivery: "authenticated-download" },
      });
      backupsSent += 1;
    } catch (error) {
      await reportServerError(error, { route: "/api/cron/pix-expiration", operation: "send-account-backup" });
    }
  }
  return { expired: expired.length, backupsSent };
}
