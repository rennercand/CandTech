import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  appendAuditEvent,
  closeDatabaseForTests,
  createUser,
  ensureOwnedOrganization,
  getDatabaseBackend,
  listAuditEventsForRoot,
} from "../lib/db.js";

async function isolatedDatabase(run) {
  const previousEnvironment = process.env.NODE_ENV;
  const previousPath = process.env.SQLITE_DATABASE_PATH;
  const directory = mkdtempSync(join(tmpdir(), "candtech-audit-"));
  process.env.NODE_ENV = "test";
  process.env.SQLITE_DATABASE_PATH = join(directory, "audit.sqlite");
  try {
    await run();
  } finally {
    await closeDatabaseForTests();
    if (previousEnvironment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnvironment;
    if (previousPath === undefined) delete process.env.SQLITE_DATABASE_PATH; else process.env.SQLITE_DATABASE_PATH = previousPath;
    rmSync(directory, { recursive: true, force: true });
  }
}

test("auditoria separa autor e alvo, registra organização e remove segredos", async () => isolatedDatabase(async () => {
  const owner = await createUser({ name: "Proprietário", email: "owner@audit.test", passwordHash: "hash" });
  const target = await createUser({ name: "Colaborador", email: "target@audit.test", passwordHash: "hash" });
  const organization = await ensureOwnedOrganization({ userId: owner.id, name: "Empresa auditada" });

  await appendAuditEvent({
    userId: target.id,
    actorUserId: owner.id,
    organizationId: organization.organizationId,
    action: "team.member.updated",
    origin: "api/team",
    subjectType: "organization_member",
    subjectId: target.id,
    previousState: { role: "attendant", accessToken: "não-pode-vazar" },
    newState: { role: "manager", permissions: ["inventory"] },
    metadata: { requestToken: "também-não", reason: "promoção" },
  });

  const backend = await getDatabaseBackend();
  const event = backend.db.prepare("SELECT * FROM audit_events WHERE action = ?").get("team.member.updated");
  assert.equal(event.user_id, target.id);
  assert.equal(event.actor_user_id, owner.id);
  assert.equal(event.organization_id, organization.organizationId);
  assert.equal(event.origin, "api/team");
  assert.equal(event.event_version, 2);
  assert.equal(event.subject_type, "organization_member");
  assert.equal(event.subject_id, String(target.id));
  assert.deepEqual(JSON.parse(event.previous_state), { role: "attendant", accessToken: "[redacted]" });
  assert.deepEqual(JSON.parse(event.new_state), { role: "manager", permissions: ["inventory"] });
  assert.deepEqual(JSON.parse(event.metadata), { requestToken: "[redacted]", reason: "promoção" });
}));

test("auditoria reduz conteúdo excessivo mantendo JSON válido e verificável", async () => isolatedDatabase(async () => {
  await appendAuditEvent({ action: "system.large_event", metadata: { details: Array.from({ length: 25 }, () => "x".repeat(1_000)) } });
  const backend = await getDatabaseBackend();
  const metadata = JSON.parse(backend.db.prepare("SELECT metadata FROM audit_events").get().metadata);
  assert.equal(metadata.truncated, true);
  assert.equal(metadata.originalBytes > 4_000, true);
  assert.match(metadata.sha256, /^[a-f0-9]{64}$/);
}));

test("consulta raiz pagina eventos e apresenta autor e empresa sem segredos", async () => isolatedDatabase(async () => {
  const owner = await createUser({ name: "Proprietário", email: "owner@audit.test", passwordHash: "hash" });
  const organization = await ensureOwnedOrganization({ userId: owner.id, name: "Empresa auditada" });
  for (let index = 0; index < 3; index += 1) {
    await appendAuditEvent({
      userId: owner.id,
      actorUserId: owner.id,
      organizationId: organization.organizationId,
      action: `test.event_${index}`,
      origin: "test/audit",
      metadata: { token: "segredo", sequence: index },
    });
  }

  const first = await listAuditEventsForRoot({ limit: 2 });
  assert.equal(first.items.length, 2);
  assert.equal(first.nextCursor, first.items[1].id);
  assert.equal(first.items[0].actor.email, owner.email);
  assert.equal(first.items[0].organization.name, "Empresa auditada");
  assert.equal(first.items[0].metadata.token, "[redacted]");
  const second = await listAuditEventsForRoot({ cursor: first.nextCursor, limit: 2 });
  assert.equal(second.items.length, 1);
  assert.equal(second.nextCursor, null);
  assert.equal(Number(second.items[0].id) < Number(first.nextCursor), true);
}));
