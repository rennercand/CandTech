import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  appendAuditEvent,
  createOrganizationInvitation,
  listOrganizationTeam,
  MAX_ORGANIZATION_MEMBERS,
  removeOrganizationMember,
  revokeOrganizationInvitation,
  updateOrganizationMember,
} from "@/lib/db";
import { getOrganizationAccess } from "@/lib/organization-access";
import { enforceRateLimit } from "@/lib/rate-limit";
import { guardMutation, readLimitedJson, requestBodyErrorResponse } from "@/lib/request-security";
import { sendTeamInvitation, teamEmailConfigured } from "@/lib/team-email";
import { normalizePermissions, normalizeRole, TEAM_AREAS } from "@/lib/team-permissions";

export const runtime = "nodejs";

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

async function ownerContext(request) {
  const user = await getSession(request);
  if (!user) return { error: NextResponse.json({ error: "Não autenticado" }, { status: 401 }) };
  const access = await getOrganizationAccess(user);
  if (!access?.organizationId || access.role !== "owner") {
    return { error: NextResponse.json({ error: "Somente o proprietário pode gerenciar a equipe." }, { status: 403 }) };
  }
  return { user, access };
}

export async function GET(request) {
  const limited = await enforceRateLimit(request, { scope: "team-read", limit: 60 });
  if (limited) return limited;
  const context = await ownerContext(request);
  if (context.error) return context.error;
  const team = await listOrganizationTeam(context.access.organizationId);
  return NextResponse.json({
    organization: { id: context.access.organizationId, name: context.access.organizationName },
    ...team,
    areas: TEAM_AREAS,
    limit: MAX_ORGANIZATION_MEMBERS,
    emailConfigured: teamEmailConfigured(),
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const limited = await enforceRateLimit(request, { scope: "team-invite", limit: 10 });
  if (limited) return limited;
  const context = await ownerContext(request);
  if (context.error) return context.error;
  try {
    const input = await readLimitedJson(request, { maxBytes: 8_192, maxDepth: 3, maxNodes: 50, maxStringLength: 254 });
    const email = String(input.email || "").trim().toLowerCase();
    const role = normalizeRole(input.role);
    const permissions = normalizePermissions(input.permissions, role);
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254 || email === String(context.user.email).toLowerCase()) {
      return NextResponse.json({ error: "Informe o e-mail de outra pessoa da equipe." }, { status: 400 });
    }
    const token = randomBytes(32).toString("base64url");
    const invitation = await createOrganizationInvitation({
      organizationId: context.access.organizationId,
      email, role, permissions, tokenHash: hashToken(token), invitedBy: context.user.id,
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1_000),
    });
    // O token fica no fragmento: navegadores não o enviam em logs HTTP nem no cabeçalho Referer.
    const inviteUrl = new URL(`/#invite=${encodeURIComponent(token)}`, request.nextUrl.origin).toString();
    const delivery = await sendTeamInvitation({
      to: email,
      organizationName: context.access.organizationName,
      inviterName: context.user.name,
      inviteUrl,
      invitationId: invitation.id,
    });
    await appendAuditEvent({ userId: context.user.id, action: "team.invitation.created", metadata: { organizationId: context.access.organizationId, role, emailSent: delivery.sent } });
    return NextResponse.json({ invitation, inviteUrl, emailSent: delivery.sent }, { status: 201 });
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    if (error?.code === "TEAM_LIMIT_REACHED") {
      return NextResponse.json({ error: `A equipe atingiu o limite de ${MAX_ORGANIZATION_MEMBERS} acessos e convites.` }, { status: 409 });
    }
    console.error("Falha ao criar convite de equipe", error);
    return NextResponse.json({ error: "Não foi possível criar o convite." }, { status: 500 });
  }
}

export async function PATCH(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const limited = await enforceRateLimit(request, { scope: "team-update", limit: 30 });
  if (limited) return limited;
  const context = await ownerContext(request);
  if (context.error) return context.error;
  try {
    const input = await readLimitedJson(request, { maxBytes: 8_192, maxDepth: 3, maxNodes: 50, maxStringLength: 254 });
    const userId = Number(input.userId);
    if (!Number.isInteger(userId) || userId <= 0 || userId === context.user.id) {
      return NextResponse.json({ error: "Membro inválido." }, { status: 400 });
    }
    const member = await updateOrganizationMember({
      organizationId: context.access.organizationId,
      userId,
      role: normalizeRole(input.role),
      permissions: normalizePermissions(input.permissions, input.role),
      status: input.status,
    });
    if (!member) return NextResponse.json({ error: "Membro não encontrado." }, { status: 404 });
    await appendAuditEvent({ userId: context.user.id, action: "team.member.updated", metadata: { organizationId: context.access.organizationId, memberUserId: userId, role: member.role } });
    return NextResponse.json({ member });
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    return NextResponse.json({ error: "Não foi possível atualizar o acesso." }, { status: 500 });
  }
}

export async function DELETE(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const limited = await enforceRateLimit(request, { scope: "team-remove", limit: 20 });
  if (limited) return limited;
  const context = await ownerContext(request);
  if (context.error) return context.error;
  try {
    const input = await readLimitedJson(request, { maxBytes: 2_048, maxDepth: 2, maxNodes: 10, maxStringLength: 50 });
    const id = Number(input.id);
    const removed = input.kind === "invitation"
      ? await revokeOrganizationInvitation({ organizationId: context.access.organizationId, invitationId: id })
      : await removeOrganizationMember({ organizationId: context.access.organizationId, userId: id });
    if (!removed) return NextResponse.json({ error: "Acesso não encontrado." }, { status: 404 });
    await appendAuditEvent({ userId: context.user.id, action: input.kind === "invitation" ? "team.invitation.revoked" : "team.member.removed", metadata: { organizationId: context.access.organizationId, targetId: id } });
    return NextResponse.json({ removed: true });
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    return NextResponse.json({ error: "Não foi possível remover o acesso." }, { status: 500 });
  }
}
