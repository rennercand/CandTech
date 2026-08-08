import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { acceptOrganizationInvitation, appendAuditEvent, findOrganizationInvitation } from "@/lib/db";
import { publicAccess } from "@/lib/organization-access";
import { enforceRateLimit } from "@/lib/rate-limit";
import { guardMutation, readLimitedJson, requestBodyErrorResponse } from "@/lib/request-security";

export const runtime = "nodejs";

function tokenHash(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function validToken(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{40,60}$/.test(value);
}

export async function PUT(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const limited = await enforceRateLimit(request, { scope: "team-invitation-read", limit: 30 });
  if (limited) return limited;
  try {
    const { token } = await readLimitedJson(request, { maxBytes: 2_048, maxDepth: 2, maxNodes: 8, maxStringLength: 100 });
    if (!validToken(token)) return NextResponse.json({ error: "Convite inválido." }, { status: 400 });
    const invitation = await findOrganizationInvitation(tokenHash(token));
    if (!invitation) return NextResponse.json({ error: "Convite inválido, cancelado ou expirado." }, { status: 404 });
    return NextResponse.json({
      invitation: {
        email: invitation.email,
        organizationName: invitation.organization_name,
        inviterName: invitation.inviter_name,
        role: invitation.role,
        expiresAt: invitation.expires_at,
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    return NextResponse.json({ error: "Não foi possível validar o convite." }, { status: 500 });
  }
}

export async function POST(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const limited = await enforceRateLimit(request, { scope: "team-invitation-accept", limit: 10 });
  if (limited) return limited;
  const user = await getSession(request);
  if (!user) return NextResponse.json({ error: "Entre ou crie sua conta para aceitar o convite." }, { status: 401 });
  try {
    const { token } = await readLimitedJson(request, { maxBytes: 2_048, maxDepth: 2, maxNodes: 8, maxStringLength: 100 });
    if (!validToken(token)) return NextResponse.json({ error: "Convite inválido." }, { status: 400 });
    const access = await acceptOrganizationInvitation({ tokenHash: tokenHash(token), userId: user.id, email: user.email });
    if (!access) {
      return NextResponse.json({ error: "O convite não corresponde a este e-mail, expirou ou a conta já pertence a outra empresa." }, { status: 409 });
    }
    await appendAuditEvent({ userId: user.id, action: "team.invitation.accepted", metadata: { organizationId: access.organizationId, role: access.role } });
    return NextResponse.json({ access: publicAccess({ ...access, isOwner: false }) });
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    if (error?.code === "OWNED_ORGANIZATION_NOT_EMPTY") {
      return NextResponse.json({ error: "Esta conta já possui uma empresa com dados, equipe ou assinatura. Para não misturar informações, aceite o convite com uma conta pessoal de colaborador." }, { status: 409 });
    }
    if (error?.code === "ACCOUNT_ALREADY_IN_ORGANIZATION") {
      return NextResponse.json({ error: "Esta conta já pertence a outra equipe. Remova o acesso anterior antes de aceitar um novo convite." }, { status: 409 });
    }
    return NextResponse.json({ error: "Não foi possível aceitar o convite." }, { status: 500 });
  }
}
