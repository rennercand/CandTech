import { appendAuditEvent } from "./db.js";
import { buildAccountBackup } from "./account-backup.js";
import { sendPixBackupEmail } from "./billing-email.js";
import { expirePixPayments, listPixPaymentsAwaitingBackup, markPixBackupSent } from "./pix-db.js";
import { reportServerError } from "./server-observability.js";

export async function processPixExpirations() {
  const expired = await expirePixPayments();
  const awaitingBackup = await listPixPaymentsAwaitingBackup();
  let backupsSent = 0;
  for (const payment of awaitingBackup) {
    try {
      const backup = await buildAccountBackup(payment.userId);
      const delivery = await sendPixBackupEmail({ payment, attachment: backup.content });
      if (!delivery.sent) continue;
      await markPixBackupSent(payment.id);
      await appendAuditEvent({
        userId: payment.userId,
        actorUserId: null,
        action: "subscription.backup_sent",
        origin: "system/pix-expiration",
        subjectType: "pix_payment_request",
        subjectId: payment.id,
        newState: { backupSent: true },
        metadata: { provider: "pix", bytes: backup.bytes },
      });
      backupsSent += 1;
    } catch (error) {
      await reportServerError(error, { route: "/api/cron/pix-expiration", operation: "send-account-backup" });
    }
  }
  return { expired: expired.length, backupsSent };
}
