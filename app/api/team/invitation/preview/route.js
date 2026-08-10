import { NextResponse } from "next/server";
import { findOrganizationInvitation } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { guardMutation, readLimitedJson, requestBodyErrorResponse } from "@/lib/request-security";
import { hashInvitationToken, publicInvitationPreview, validInvitationToken } from "@/lib/team-invitation";

export const runtime = "nodejs";

// Esta é a única consulta pública do convite. O token continua fora da URL da
// API e a resposta omite IDs, e-mail completo e qualquer dado do workspace.
export async function POST(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const limited = await enforceRateLimit(request, { scope: "team-invitation-preview", limit: 20 });
  if (limited) return limited;
  try {
    const { token } = await readLimitedJson(request, {
      maxBytes: 2_048, maxDepth: 2, maxNodes: 8, maxStringLength: 100,
    });
    if (!validInvitationToken(token)) {
      return NextResponse.json({ error: "Convite inválido." }, { status: 400 });
    }
    const invitation = await findOrganizationInvitation(hashInvitationToken(token));
    if (!invitation) {
      return NextResponse.json({ error: "Este convite é inválido, foi cancelado ou expirou." }, { status: 404 });
    }
    return NextResponse.json(
      { invitation: publicInvitationPreview(invitation) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    return NextResponse.json({ error: "Não foi possível consultar o convite." }, { status: 500 });
  }
}
