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

export const runtime = "nodejs";

const MAX_WORKSPACE_SIZE = 500_000;

function hasMeaningfulContent(payload) {
  // Evita criar um item de histórico quando a pessoa apenas abriu e fechou o site.
  const inputs = payload?.inputs || {};
  const hasCalculation =
    Number(inputs.investment) !== 0 ||
    Number(inputs.rate) !== 0 ||
    Number(inputs.periods) > 0 ||
    (inputs.flows || []).some((flow) => Number(flow?.amount ?? flow) !== 0);
  const hasOrganization = (payload?.cashEntries || []).some(
    (entry) => String(entry?.description || "").trim() || Number(entry?.amount) !== 0,
  );
  const hasFinancialTable =
    Number(payload?.financeState?.form?.principal) > 0 &&
    Number(payload?.financeState?.form?.periods) > 0;
  const hasAccounts = (payload?.financialAccounts || []).some(
    (item) => String(item?.description || item?.party || "").trim() || Number(item?.amount) !== 0,
  );
  const hasInventory = (payload?.inventoryState?.products || []).some(
    (item) => String(item?.name || item?.sku || "").trim() || Number(item?.quantity) !== 0,
  ) || (payload?.inventoryState?.deliveries || []).some(
    (item) => String(item?.description || item?.tracking || "").trim(),
  );
  const hasCommerce = (payload?.commerceOrders || []).some(
    (item) => String(item?.number || item?.partner || "").trim() || Number(item?.amount) !== 0,
  );
  return hasCalculation || hasOrganization || hasFinancialTable || hasAccounts || hasInventory || hasCommerce;
}

function validPayload(payload) {
  return payload && typeof payload === "object" && JSON.stringify(payload).length <= MAX_WORKSPACE_SIZE;
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

  let workspace = await getWorkspace(access.ownerUserId);
  // Garante o histórico no próximo login mesmo se o navegador encerrou antes do pagehide terminar.
  if (
    workspace &&
    hasPermission(access, "history") &&
    workspace.revision > workspace.archived_revision &&
    hasMeaningfulContent(workspace.payload)
  ) {
    await archiveWorkspace({ userId: access.ownerUserId, title: automaticTitle() });
    workspace = await getWorkspace(access.ownerUserId);
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
    const current = await getWorkspace(access.ownerUserId);
    const merged = mergeWorkspaceForAccess(current?.payload || {}, payload, access);
    const workspace = await saveWorkspace({ userId: access.ownerUserId, payload: merged, markSaved: Boolean(markSaved) });
    return NextResponse.json({ workspace: { ...workspace, payload: filterWorkspaceForAccess(workspace.payload, access) } });
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    console.error("Falha ao salvar rascunho", error);
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

    const current = await getWorkspace(access.ownerUserId);
    const merged = mergeWorkspaceForAccess(current?.payload || {}, payload, access);
    await saveWorkspace({ userId: access.ownerUserId, payload: merged });
    if (!hasMeaningfulContent(merged)) {
      // Marca o estado vazio como tratado para não tentar arquivá-lo em toda saída.
      await saveWorkspace({ userId: access.ownerUserId, payload: merged, markSaved: true });
      return NextResponse.json({ archived: false });
    }

    const item = await archiveWorkspace({
      userId: access.ownerUserId,
      title: automaticTitle(),
    });
    return NextResponse.json({ archived: Boolean(item), item });
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    console.error("Falha ao arquivar rascunho", error);
    return NextResponse.json({ error: "Não foi possível arquivar o rascunho." }, { status: 500 });
  }
}
