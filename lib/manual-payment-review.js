import { getDatabaseBackend } from "./db.js";
import { getPixPaymentById } from "./pix-db.js";

/**
 * Revisão manual feita pela equipe autorizada da CandTech.
 * O comprovante é opcional: o administrador pode confirmar diretamente após
 * localizar o recebimento no banco. A única fonte de liberação continua sendo
 * esta ação autenticada no backend; cliente, upload ou frontend não ativam acesso.
 */
export async function reviewPixPaymentManually({ id, approved, administratorId }) {
  const backend = await getDatabaseBackend();

  if (backend.type === "postgres") {
    const rows = approved
      ? await backend.sql`WITH reviewed AS (
          UPDATE pix_payment_requests p
          SET status='approved', reviewed_by=${administratorId}, reviewed_at=NOW(), updated_at=NOW()
          WHERE p.public_id=${id} AND p.status IN ('pending','payment_review')
          RETURNING p.*
        ), billing AS (
          UPDATE billing_profiles b
          SET payment_provider='pix', subscription_status='active',
            subscription_current_period_end=GREATEST(COALESCE(b.subscription_current_period_end, NOW()), NOW()) + INTERVAL '30 days',
            updated_at=NOW()
          FROM reviewed WHERE b.user_id=reviewed.user_id
          RETURNING b.user_id
        ) SELECT reviewed.* FROM reviewed JOIN billing ON billing.user_id=reviewed.user_id`
      : await backend.sql`WITH reviewed AS (
          UPDATE pix_payment_requests p
          SET status='rejected', reviewed_by=${administratorId}, reviewed_at=NOW(), updated_at=NOW()
          WHERE p.public_id=${id} AND p.status IN ('pending','payment_review')
          RETURNING p.*
        ), billing AS (
          UPDATE billing_profiles b
          SET payment_provider='pix', subscription_status='canceled', subscription_current_period_end=NULL, updated_at=NOW()
          FROM reviewed WHERE b.user_id=reviewed.user_id
          RETURNING b.user_id
        ) SELECT reviewed.* FROM reviewed JOIN billing ON billing.user_id=reviewed.user_id`;

    if (!rows.length) return null;
    return getPixPaymentById(id);
  }

  backend.db.exec("BEGIN IMMEDIATE");
  try {
    const row = backend.db.prepare("SELECT * FROM pix_payment_requests WHERE public_id=? AND status IN ('pending','payment_review')").get(id);
    if (!row) {
      backend.db.exec("ROLLBACK");
      return null;
    }

    let periodEnd = null;
    if (approved) {
      const currentBilling = backend.db.prepare("SELECT subscription_current_period_end FROM billing_profiles WHERE user_id=?").get(row.user_id);
      const base = currentBilling?.subscription_current_period_end && new Date(currentBilling.subscription_current_period_end) > new Date()
        ? new Date(currentBilling.subscription_current_period_end)
        : new Date();
      periodEnd = new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    }

    backend.db.prepare("UPDATE pix_payment_requests SET status=?, reviewed_by=?, reviewed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(approved ? "approved" : "rejected", administratorId, row.id);
    backend.db.prepare("UPDATE billing_profiles SET payment_provider='pix', subscription_status=?, subscription_current_period_end=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?")
      .run(approved ? "active" : "canceled", periodEnd, row.user_id);
    backend.db.exec("COMMIT");
    return getPixPaymentById(id);
  } catch (error) {
    backend.db.exec("ROLLBACK");
    throw error;
  }
}
