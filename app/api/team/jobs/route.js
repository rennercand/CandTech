import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  appendAuditEvent,
  createOrganizationJob,
  listOrganizationJobs,
  MAX_ORGANIZATION_JOBS,
  removeOrganizationJob,
  updateOrganizationJob,
} from "@/lib/db";
import { getOrganizationAccess } from "@/lib/organization-access";
import { enforceRateLimit } from "@/lib/rate-limit";
import { guardMutation, readLimitedJson, requestBodyErrorResponse } from "@/lib/request-security";
import { normalizePermissions, normalizeRole } from "@/lib/team-permissions";

export const runtime = "nodejs";

async function ownerContext(request) {
  const user = await getSession(request);
  if (!user) return { error: NextResponse.json({ error: "Não autenticado" }, { status: 401 }) };
  const access = await getOrganizationAccess(user);
  if (!access?.organizationId || access.role !== "owner") {
    return { error: NextResponse.json({ error: "Somente o proprietário pode gerenciar cargos." }, { status: 403 }) };
  }
  return { user, access };
}

function validName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ").slice(0, 80);
  return name.length >= 2 ? name : "";
}

function jobErrorResponse(error) {
  if (error?.code === "JOB_ALREADY_EXISTS") {
    return NextResponse.json({ error: "Já existe um cargo com esse nome." }, { status: 409 });
  }
  if (error?.code === "JOB_LIMIT_REACHED") {
    return NextResponse.json({ error: `A empresa atingiu o limite de ${MAX_ORGANIZATION_JOBS} cargos.` }, { status: 409 });
  }
  return null;
}

export async function GET(request) {
  const limited = await enforceRateLimit(request, { scope: "team-jobs-read", limit: 60 });
  if (limited) return limited;
  const context = await ownerContext(request);
  if (context.error) return context.error;
  return NextResponse.json({ jobs: await listOrganizationJobs(context.access.organizationId) }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const limited = await enforceRateLimit(request, { scope: "team-jobs-create", limit: 20 });
  if (limited) return limited;
  const context = await ownerContext(request);
  if (context.error) return context.error;
  try {
    const input = await readLimitedJson(request, { maxBytes: 8_192, maxDepth: 3, maxNodes: 50, maxStringLength: 100 });
    const name = validName(input.name);
    if (!name) return NextResponse.json({ error: "Informe um nome de cargo com pelo menos 2 caracteres." }, { status: 400 });
    const role = normalizeRole(input.role);
    const job = await createOrganizationJob({
      organizationId: context.access.organizationId,
      name,
      role,
      permissions: normalizePermissions(input.permissions, role),
    });
    await appendAuditEvent({ userId: context.user.id, action: "team.job.created", metadata: { organizationId: context.access.organizationId, jobId: job.id } });
    return NextResponse.json({ job }, { status: 201 });
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    const known = jobErrorResponse(error);
    if (known) return known;
    console.error("Falha ao criar cargo", error);
    return NextResponse.json({ error: "Não foi possível criar o cargo." }, { status: 500 });
  }
}

export async function PATCH(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const limited = await enforceRateLimit(request, { scope: "team-jobs-update", limit: 30 });
  if (limited) return limited;
  const context = await ownerContext(request);
  if (context.error) return context.error;
  try {
    const input = await readLimitedJson(request, { maxBytes: 8_192, maxDepth: 3, maxNodes: 50, maxStringLength: 100 });
    const jobId = Number(input.id);
    const name = validName(input.name);
    if (!Number.isInteger(jobId) || jobId <= 0 || !name) {
      return NextResponse.json({ error: "Cargo inválido." }, { status: 400 });
    }
    const role = normalizeRole(input.role);
    const job = await updateOrganizationJob({
      organizationId: context.access.organizationId,
      jobId,
      name,
      role,
      permissions: normalizePermissions(input.permissions, role),
    });
    if (!job) return NextResponse.json({ error: "Cargo não encontrado." }, { status: 404 });
    await appendAuditEvent({ userId: context.user.id, action: "team.job.updated", metadata: { organizationId: context.access.organizationId, jobId } });
    return NextResponse.json({ job });
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    const known = jobErrorResponse(error);
    if (known) return known;
    console.error("Falha ao atualizar cargo", error);
    return NextResponse.json({ error: "Não foi possível atualizar o cargo." }, { status: 500 });
  }
}

export async function DELETE(request) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const limited = await enforceRateLimit(request, { scope: "team-jobs-remove", limit: 20 });
  if (limited) return limited;
  const context = await ownerContext(request);
  if (context.error) return context.error;
  try {
    const input = await readLimitedJson(request, { maxBytes: 2_048, maxDepth: 2, maxNodes: 10, maxStringLength: 50 });
    const jobId = Number(input.id);
    if (!Number.isInteger(jobId) || jobId <= 0) return NextResponse.json({ error: "Cargo inválido." }, { status: 400 });
    const removed = await removeOrganizationJob({ organizationId: context.access.organizationId, jobId });
    if (!removed) return NextResponse.json({ error: "Cargo não encontrado." }, { status: 404 });
    await appendAuditEvent({ userId: context.user.id, action: "team.job.removed", metadata: { organizationId: context.access.organizationId, jobId } });
    return NextResponse.json({ removed: true });
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    return NextResponse.json({ error: "Não foi possível excluir o cargo." }, { status: 500 });
  }
}
