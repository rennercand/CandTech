import { zipSync, strToU8 } from "fflate";
import { findOrganizationAccess, findUserById, getBillingProfile, getWorkspace, listHistories } from "./db.js";
import { inventoryTenant } from "./inventory.js";
import { listInventory } from "./inventory-db.js";

const MAX_BACKUP_BYTES = 15 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;

async function exportHistories(ownerUserId, organizationId) {
  const rows = [];
  let cursor;
  let bytes = 0;
  do {
    const page = await listHistories(ownerUserId, null, { organizationId, limit: 50, cursor });
    if (page.invalidCursor) throw new Error("BACKUP_INVALID_HISTORY_CURSOR");
    for (const row of page.rows) {
      bytes += Buffer.byteLength(JSON.stringify(row), "utf8");
      if (bytes > MAX_UNCOMPRESSED_BYTES || rows.length >= 10000) throw new Error("BACKUP_TOO_LARGE_FOR_EMAIL");
      rows.push(row);
    }
    cursor = page.nextCursor;
  } while (cursor);
  return rows;
}

export async function buildAccountBackup(userId) {
  const user = await findUserById(userId);
  if (!user) throw new Error("BACKUP_USER_NOT_FOUND");
  const access = await findOrganizationAccess(userId);
  const ownerUserId = Number(access?.ownerUserId || userId);
  const tenantId = inventoryTenant({ organizationId: access?.organizationId || null, ownerUserId });
  const [profile, workspace, histories, inventory] = await Promise.all([
    getBillingProfile(ownerUserId, user.account_type),
    getWorkspace(ownerUserId, access?.organizationId || null),
    exportHistories(ownerUserId, access?.organizationId || null),
    listInventory(tenantId),
  ]);
  const backup = {
    format: "candtech-account-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    owner: { name: user.name, email: user.email, accountType: user.account_type || "person" },
    organization: access ? { id: Number(access.organizationId), name: access.organizationName || "" } : null,
    profile,
    workspace: workspace?.payload || {},
    documents: histories,
    inventory,
  };
  const json = JSON.stringify(backup, null, 2);
  if (Buffer.byteLength(json, "utf8") > MAX_UNCOMPRESSED_BYTES) throw new Error("BACKUP_TOO_LARGE_FOR_EMAIL");
  const archive = zipSync({ "backup-candtech.json": strToU8(json) }, { level: 6 });
  if (archive.byteLength > MAX_BACKUP_BYTES) throw new Error("BACKUP_TOO_LARGE_FOR_EMAIL");
  return { content: Buffer.from(archive).toString("base64"), bytes: archive.byteLength };
}
