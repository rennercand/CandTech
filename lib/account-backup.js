import { zipSync, strToU8 } from "fflate";
import { findOrganizationAccess, findUserById, getBillingProfile, getWorkspace, listHistories } from "./db.js";
import { inventoryTenant } from "./inventory.js";
import { listInventory } from "./inventory-db.js";

const MAX_BACKUP_BYTES = 15 * 1024 * 1024;

export async function buildAccountBackup(userId) {
  const user = await findUserById(userId);
  if (!user) throw new Error("BACKUP_USER_NOT_FOUND");
  const access = await findOrganizationAccess(userId);
  const ownerUserId = Number(access?.ownerUserId || userId);
  const tenantId = inventoryTenant({ organizationId: access?.organizationId || null, ownerUserId });
  const [profile, workspace, histories, inventory] = await Promise.all([
    getBillingProfile(ownerUserId, user.account_type),
    getWorkspace(ownerUserId, access?.organizationId || null),
    listHistories(ownerUserId, null, { organizationId: access?.organizationId || null, limit: 50 }),
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
    documents: histories.rows,
    inventory,
  };
  const json = JSON.stringify(backup, null, 2);
  const archive = zipSync({ "backup-candtech.json": strToU8(json) }, { level: 6 });
  if (archive.byteLength > MAX_BACKUP_BYTES) throw new Error("BACKUP_TOO_LARGE_FOR_EMAIL");
  return { content: Buffer.from(archive).toString("base64"), bytes: archive.byteLength };
}
