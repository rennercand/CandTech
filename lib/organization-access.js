import { ensureOwnedOrganization, findHistoryById, findOrganizationAccess, serializeHistory } from "@/lib/db";
import { ALL_TEAM_PERMISSIONS, filterHistoryForAccess, hasPermission } from "@/lib/team-permissions";

// Resolve o usuário que realmente possui os dados compartilhados da empresa.
export async function getOrganizationAccess(user) {
  if (!user) return null;
  let access = await findOrganizationAccess(user.id);
  if (!access && user.accountType === "company") {
    access = await ensureOwnedOrganization({ userId: user.id, name: user.name });
  }
  if (access) return { ...access, userId: user.id, isOwner: access.role === "owner" };
  return {
    organizationId: null,
    organizationName: null,
    ownerUserId: user.id,
    userId: user.id,
    role: "personal",
    permissions: ALL_TEAM_PERMISSIONS,
    isOwner: true,
  };
}

export async function requirePermission(user, permission) {
  const access = await getOrganizationAccess(user);
  return access && hasPermission(access, permission) ? access : null;
}

export function publicAccess(access) {
  if (!access) return null;
  return {
    organizationId: access.organizationId,
    organizationName: access.organizationName,
    role: access.role,
    jobTitle: access.jobTitle || "",
    permissions: access.permissions,
    isOwner: access.isOwner,
  };
}

export async function getAccessibleHistory({ user, id, permissions = ["history"] }) {
  const access = await getOrganizationAccess(user);
  if (!permissions.every((permission) => hasPermission(access, permission))) return { access, item: null, forbidden: true };
  const row = await findHistoryById(Number(id), access.ownerUserId);
  const item = row ? filterHistoryForAccess(serializeHistory(row), access) : null;
  return { access, item, forbidden: false };
}
