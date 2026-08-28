import { getDatabaseBackend } from "./db.js";

function serialize(row) {
  if (!row) return null;
  return {
    id: row.public_id,
    userId: Number(row.user_id),
    amountCents: Number(row.amount_cents),
    kind: row.kind,
    status: row.status,
    txid: row.txid,
    dueAt: row.due_at,
    reviewedAt: row.reviewed_at || null,
    backupSentAt: row.backup_sent_at || null,
    createdAt: row.created_at,
    receipt: row.receipt_public_id ? {
      id: row.receipt_public_id,
      originalFilename: row.receipt_original_filename,
      contentType: row.receipt_content_type,
      sizeBytes: Number(row.receipt_size_bytes),
      uploadedAt: row.receipt_uploaded_at,
    } : null,
    customer: {
      accountType: row.billing_account_type || row.user_account_type || "person",
      billingName: row.billing_name || row.user_name || "",
      name: row.user_name || "",
      email: row.user_email || "",
      phone: row.user_phone || "",
      organization: row.organization_name || "",
    },
  };
}

/**
 * Lista administrativa otimizada para cobrança. A identificação é obtida dos
 * dados já cadastrados no ERP; nunca solicita nem retorna senha do usuário.
 */
export async function listPaymentsForPrivateCentral() {
  const backend = await getDatabaseBackend();
  const rows = backend.type === "postgres"
    ? await backend.sql`SELECT p.*, u.name AS user_name, u.email AS user_email, u.account_type AS user_account_type,
        COALESCE(b.phone, '') AS user_phone, COALESCE(b.legal_name, u.name, '') AS billing_name,
        COALESCE(b.account_type, u.account_type, 'person') AS billing_account_type,
        COALESCE(o.name, '') AS organization_name, r.public_id AS receipt_public_id,
        r.original_filename AS receipt_original_filename, r.content_type AS receipt_content_type,
        r.size_bytes AS receipt_size_bytes, r.uploaded_at AS receipt_uploaded_at
      FROM pix_payment_requests p
      JOIN users u ON u.id=p.user_id
      LEFT JOIN billing_profiles b ON b.user_id=p.user_id
      LEFT JOIN organizations o ON o.owner_user_id=p.user_id
      LEFT JOIN pix_payment_receipts r ON r.payment_id=p.id AND r.active=TRUE
      ORDER BY CASE p.status WHEN 'payment_review' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, p.created_at DESC
      LIMIT 200`
    : backend.db.prepare(`SELECT p.*, u.name AS user_name, u.email AS user_email, u.account_type AS user_account_type,
        COALESCE(b.phone, '') AS user_phone, COALESCE(NULLIF(b.legal_name, ''), u.name, '') AS billing_name,
        COALESCE(b.account_type, u.account_type, 'person') AS billing_account_type,
        COALESCE(o.name, '') AS organization_name, r.public_id AS receipt_public_id,
        r.original_filename AS receipt_original_filename, r.content_type AS receipt_content_type,
        r.size_bytes AS receipt_size_bytes, r.uploaded_at AS receipt_uploaded_at
      FROM pix_payment_requests p
      JOIN users u ON u.id=p.user_id
      LEFT JOIN billing_profiles b ON b.user_id=p.user_id
      LEFT JOIN organizations o ON o.owner_user_id=p.user_id
      LEFT JOIN pix_payment_receipts r ON r.payment_id=p.id AND r.active=1
      ORDER BY CASE p.status WHEN 'payment_review' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, p.created_at DESC
      LIMIT 200`).all();
  return rows.map(serialize);
}
