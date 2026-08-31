import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { strFromU8, unzipSync } from "fflate";
import { buildAccountBackup } from "../lib/account-backup.js";
import {
  closeDatabaseForTests,
  createHistory,
  createUser,
  ensureOwnedOrganization,
  findHistoryById,
  getWorkspace,
  listCustomers,
  listHistories,
  listOperationalTasks,
  saveHistory,
  saveWorkspace,
} from "../lib/db.js";

test("workspace e histórico exigem proprietário e organização na mesma consulta", async () => {
  const previous = { nodeEnv: process.env.NODE_ENV, sqlitePath: process.env.SQLITE_DATABASE_PATH };
  const directory = mkdtempSync(join(tmpdir(), "candtech-tenant-scope-"));
  process.env.NODE_ENV = "test";
  process.env.SQLITE_DATABASE_PATH = join(directory, "tenant.sqlite");
  try {
    const ownerA = await createUser({ name: "Empresa A", email: "tenant-a@test.local", passwordHash: "hash", accountType: "company" });
    const ownerB = await createUser({ name: "Empresa B", email: "tenant-b@test.local", passwordHash: "hash", accountType: "company" });
    const organizationA = await ensureOwnedOrganization({ userId: ownerA.id, name: "Empresa A" });
    const organizationB = await ensureOwnedOrganization({ userId: ownerB.id, name: "Empresa B" });

    const workspacePayload = {
      cashEntries: [{ description: "Privado A", amount: 50 }],
      clients: [{ id: "client-a", name: "Cliente A", email: "cliente-a@test.local", phone: "11999999999", status: "active", notes: "Somente A", createdAt: "2026-08-31T10:00:00.000Z" }],
      tasks: [{ id: "task-a", clientId: "client-a", title: "Atender cliente A", dueDate: "2026-09-01", priority: "high", status: "doing", createdAt: "2026-08-31T10:05:00.000Z", completedAt: "" }],
    };
    await saveWorkspace({ userId: ownerA.id, organizationId: organizationA.organizationId, payload: workspacePayload });
    const restoredWorkspace = await getWorkspace(ownerA.id, organizationA.organizationId);
    assert.equal(restoredWorkspace.payload.cashEntries[0].description, "Privado A");
    assert.equal(restoredWorkspace.payload.clients[0].name, "Cliente A");
    assert.equal(restoredWorkspace.payload.tasks[0].clientId, "client-a");
    assert.deepEqual((await listCustomers(ownerA.id, organizationA.organizationId)).map((client) => client.id), ["client-a"]);
    assert.deepEqual((await listOperationalTasks(ownerA.id, organizationA.organizationId)).map((task) => task.id), ["task-a"]);
    assert.deepEqual(await listCustomers(ownerB.id, organizationA.organizationId), []);
    assert.deepEqual(await listOperationalTasks(ownerB.id, organizationA.organizationId), []);
    assert.equal(await getWorkspace(ownerA.id, null), null);
    assert.equal(await getWorkspace(ownerB.id, organizationA.organizationId), null);
    await assert.rejects(
      saveWorkspace({ userId: ownerA.id, organizationId: organizationB.organizationId, payload: { cashEntries: [] } }),
      { code: "ORGANIZATION_SCOPE_MISMATCH" },
    );

    const history = await createHistory({
      userId: ownerA.id,
      organizationId: organizationA.organizationId,
      title: "Documento privado A",
      calculationType: "fluxo-caixa",
      payload: { secret: "A" },
    });
    assert.equal((await findHistoryById(history.id, ownerA.id, organizationA.organizationId)).title, "Documento privado A");
    assert.equal(await findHistoryById(history.id, ownerA.id, null), null);
    assert.equal(await findHistoryById(history.id, ownerB.id, organizationA.organizationId), null);
    assert.deepEqual((await listHistories(ownerA.id, null, { organizationId: organizationA.organizationId })).rows.map((row) => row.id), [history.id]);
    await assert.rejects(
      saveHistory({ userId: ownerA.id, organizationId: organizationB.organizationId, title: "Tentativa", calculationType: "fluxo-caixa", payload: {} }),
      { code: "ORGANIZATION_SCOPE_MISMATCH" },
    );

    const backup = await buildAccountBackup(ownerA.id);
    const files = unzipSync(new Uint8Array(Buffer.from(backup.content, "base64")));
    const exported = JSON.parse(strFromU8(files["backup-candtech.json"]));
    assert.equal(exported.organization.id, organizationA.organizationId);
    assert.equal(exported.workspace.cashEntries[0].description, "Privado A");
    assert.equal(exported.workspace.clients[0].name, "Cliente A");
    assert.equal(exported.workspace.tasks[0].title, "Atender cliente A");
    assert.deepEqual(exported.documents.map((item) => item.id), [history.id]);

    await saveWorkspace({
      userId: ownerA.id,
      organizationId: organizationA.organizationId,
      payload: { ...workspacePayload, clients: [], tasks: [] },
    });
    assert.deepEqual((await getWorkspace(ownerA.id, organizationA.organizationId)).payload.clients, []);
    assert.deepEqual((await getWorkspace(ownerA.id, organizationA.organizationId)).payload.tasks, []);
    assert.deepEqual(await listCustomers(ownerA.id, organizationA.organizationId), []);
    assert.deepEqual(await listOperationalTasks(ownerA.id, organizationA.organizationId), []);
  } finally {
    await closeDatabaseForTests();
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.nodeEnv;
    if (previous.sqlitePath === undefined) delete process.env.SQLITE_DATABASE_PATH;
    else process.env.SQLITE_DATABASE_PATH = previous.sqlitePath;
    rmSync(directory, { recursive: true, force: true });
  }
});
