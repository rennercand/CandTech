import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  archiveWorkspace,
  getWorkspace,
  saveWorkspace,
} from "@/lib/db";
import { guardMutation, readLimitedJson, requestBodyErrorResponse } from "@/lib/request-security";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getOrganizationAccess } from "@/lib/organization-access";
import { filterWorkspaceForAccess, hasPermission, mergeWorkspaceForAccess } from "@/lib/team-permissions";
import { hasMeaningfulWorkspaceContent } from "@/lib/workspace-content";
import { reportServerError } from "@/lib/server-observability";
import { validateWorkspacePayload } from "@/lib/workspace-validation";

export const runtime = "nodejs";

const MAX_WORKSPACE_SIZE = 500_000;

function validPayload(payload) {
  return validateWorkspacePayload(payload, { maxSerializedLength: MAX_WORKSPACE_SIZE });
}

function automaticTitle() {
  const date = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
  return `Rascunho automático · ${date}`;
}

export async function GET(request) {
  const limited = await enforceRateLimit(request, { scope: "workspace-read", limit: 120 });
  if (limited) return limited;
  const user = await getSession(request);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const access = await getOrganizationAccess(user);

  let workspace = await getWorkspace(access.ownerUserId, access.organizationId);
  // Garante o histórico no próximo login mesmo se o navegador encerrou antes do pagehide terminar.
  if (
    workspace &&
    hasPermission(access, "history") &&
    workspace.revision > workspace.archived_revision &&
    hasMeaningfulWorkspaceContent(workspace.payload)
  ) {
    await archiveWorkspace({ userId: access.ownerUserId, organizationId: access.organizationId, title: automaticTitle() });
    workspace = await getWorkspace(access.ownerUserId, access.organizationId);
  }
  const visibleWorkspace = workspace
    ? { ...workspace, payload: filterWorkspaceForAccess(workspace.payload, access) }
    : null;
  return NextResponse.json({ workspace: visibleWorkspace });
}

export async function PUT(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  // Autosave é frequente, por isso recebe um limite maior que salvamentos manuais.
  const limited = await enforceRateLimit(request, { scope: "workspace-write", limit: 120 });
  if (limited) return limited;
  const user = await getSession(request);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const access = await getOrganizationAccess(user);

  try {
    const { payload, markSaved = false } = await readLimitedJson(request, {
      maxBytes: 512_000, maxDepth: 12, maxNodes: 12_000, maxStringLength: 20_000,
    });
    if (!validPayload(payload)) {
      return NextResponse.json({ error: "Rascunho inválido ou muito grande." }, { status: 400 });
    }
    const current = await getWorkspace(access.ownerUserId, access.organizationId);
    const merged = mergeWorkspaceForAccess(current?.payload || {}, payload, access);
    await saveWorkspace({ userId: access.ownerUserId, organizationId: access.organizationId, payload: merged, markSaved: Boolean(markSaved) });
    // A interface já possui o estado salvo e precisa somente da confirmação.
    // A resposta constante impede que revisão/data de um autosave façam um
    // scanner interpretar a mutação normal como resultado de uma condição SQL.
    return NextResponse.json({ saved: true });
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    reportServerError(error, { request, route: "/api/workspace", operation: "save" });
    return NextResponse.json({ error: "Não foi possível salvar o rascunho." }, { status: 500 });
  }
}

export async function POST(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const limited = await enforceRateLimit(request, { scope: "workspace-archive", limit: 30 });
  if (limited) return limited;
  const user = await getSession(request);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const access = await getOrganizationAccess(user);

  try {
    const { payload } = await readLimitedJson(request, {
      maxBytes: 512_000, maxDepth: 12, maxNodes: 12_000, maxStringLength: 20_000,
    });
    if (!validPayload(payload)) {
      return NextResponse.json({ error: "Rascunho inválido ou muito grande." }, { status: 400 });
    }

    const current = await getWorkspace(access.ownerUserId, access.organizationId);
    const merged = mergeWorkspaceForAccess(current?.payload || {}, payload, access);
    await saveWorkspace({ userId: access.ownerUserId, organizationId: access.organizationId, payload: merged });
    if (!hasMeaningfulWorkspaceContent(merged)) {
      // Marca o estado vazio como tratado para não tentar arquivá-lo em toda saída.
      await saveWorkspace({ userId: access.ownerUserId, organizationId: access.organizationId, payload: merged, markSaved: true });
      return NextResponse.json({ archived: false });
    }

    const item = await archiveWorkspace({
      userId: access.ownerUserId,
      organizationId: access.organizationId,
      title: automaticTitle(),
    });
    return NextResponse.json({ archived: Boolean(item), id: item?.id || null });
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    reportServerError(error, { request, route: "/api/workspace", operation: "archive" });
    return NextResponse.json({ error: "Não foi possível arquivar o rascunho." }, { status: 500 });
  }
}
