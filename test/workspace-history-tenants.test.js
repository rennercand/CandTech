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
  listFinancialCommitments,
  listFinancialLedgerEntries,
  listHistories,
  listOperationalDeliveries,
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
      clients: [{ id: "client-a", name: "Cliente A", email: "cliente-a@test.local", phone: "11999999999", status: "active", notes: "Somente A", createdAt: "2026-08-31T10:00:00.000Z" }],
      tasks: [{ id: "task-a", clientId: "client-a", title: "Atender cliente A", dueDate: "2026-09-01", priority: "high", status: "doing", createdAt: "2026-08-31T10:05:00.000Z", completedAt: "" }],
      inventoryState: { deliveries: [{ id: "delivery-a", clientId: "client-a", description: "Enviar pedido A", partner: "Cliente A", direction: "saida", date: "2026-09-02", status: "em-transito", tracking: "RASTREIO-A" }] },
      financialAccounts: [{ id: "commitment-a", type: "receber", description: "Projeto A", party: "Cliente A", category: "Serviços", dueDate: "2026-09-05", amount: "250", status: "recebido", postedAt: "2026-08-31T12:00:00.000Z" }],
      cashEntries: [{ id: "entry-a", sourceCommitmentId: "commitment-a", date: "2026-08-31", category: "Serviços", description: "Recebimento Projeto A", type: "entrada", amount: "250", importBatchId: "batch-a", fingerprint: "a".repeat(64), importedAt: "2026-08-31T12:30:00.000Z" }],
    };
    await saveWorkspace({ userId: ownerA.id, organizationId: organizationA.organizationId, payload: workspacePayload });
    const restoredWorkspace = await getWorkspace(ownerA.id, organizationA.organizationId);
    assert.equal(restoredWorkspace.payload.cashEntries[0].description, "Recebimento Projeto A");
    assert.equal(restoredWorkspace.payload.clients[0].name, "Cliente A");
    assert.equal(restoredWorkspace.payload.tasks[0].clientId, "client-a");
    assert.equal(restoredWorkspace.payload.inventoryState.deliveries[0].clientId, "client-a");
    assert.equal(restoredWorkspace.payload.financialAccounts[0].status, "recebido");
    assert.equal(restoredWorkspace.payload.cashEntries[0].sourceCommitmentId, "commitment-a");
    assert.equal(restoredWorkspace.payload.cashEntries[0].importBatchId, "batch-a");
    assert.equal(restoredWorkspace.payload.cashEntries[0].fingerprint, "a".repeat(64));
    assert.equal(restoredWorkspace.payload.cashEntries[0].importedAt, "2026-08-31T12:30:00.000Z");
    assert.deepEqual((await listCustomers(ownerA.id, organizationA.organizationId)).map((client) => client.id), ["client-a"]);
    assert.deepEqual((await listOperationalTasks(ownerA.id, organizationA.organizationId)).map((task) => task.id), ["task-a"]);
    assert.deepEqual((await listOperationalDeliveries(ownerA.id, organizationA.organizationId)).map((delivery) => delivery.id), ["delivery-a"]);
    assert.deepEqual((await listFinancialCommitments(ownerA.id, organizationA.organizationId)).map((item) => item.id), ["commitment-a"]);
    assert.deepEqual((await listFinancialLedgerEntries(ownerA.id, organizationA.organizationId)).map((item) => item.id), ["entry-a"]);
    assert.deepEqual(await listCustomers(ownerB.id, organizationA.organizationId), []);
    assert.deepEqual(await listOperationalTasks(ownerB.id, organizationA.organizationId), []);
    assert.deepEqual(await listOperationalDeliveries(ownerB.id, organizationA.organizationId), []);
    assert.deepEqual(await listFinancialCommitments(ownerB.id, organizationA.organizationId), []);
    assert.deepEqual(await listFinancialLedgerEntries(ownerB.id, organizationA.organizationId), []);
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
    assert.equal(exported.workspace.cashEntries[0].description, "Recebimento Projeto A");
    assert.equal(exported.workspace.clients[0].name, "Cliente A");
    assert.equal(exported.workspace.tasks[0].title, "Atender cliente A");
    assert.equal(exported.workspace.inventoryState.deliveries[0].tracking, "RASTREIO-A");
    assert.equal(exported.workspace.financialAccounts[0].id, "commitment-a");
    assert.equal(exported.workspace.cashEntries[0].id, "entry-a");
    assert.deepEqual(exported.documents.map((item) => item.id), [history.id]);

    await saveWorkspace({
      userId: ownerA.id,
      organizationId: organizationA.organizationId,
      payload: { ...workspacePayload, clients: [], tasks: [], inventoryState: { deliveries: [] }, financialAccounts: [], cashEntries: [] },
    });
    assert.deepEqual((await getWorkspace(ownerA.id, organizationA.organizationId)).payload.clients, []);
    assert.deepEqual((await getWorkspace(ownerA.id, organizationA.organizationId)).payload.tasks, []);
    assert.deepEqual((await getWorkspace(ownerA.id, organizationA.organizationId)).payload.inventoryState.deliveries, []);
    assert.deepEqual((await getWorkspace(ownerA.id, organizationA.organizationId)).payload.financialAccounts, []);
    assert.deepEqual((await getWorkspace(ownerA.id, organizationA.organizationId)).payload.cashEntries, []);
    assert.deepEqual(await listCustomers(ownerA.id, organizationA.organizationId), []);
    assert.deepEqual(await listOperationalTasks(ownerA.id, organizationA.organizationId), []);
    assert.deepEqual(await listOperationalDeliveries(ownerA.id, organizationA.organizationId), []);
    assert.deepEqual(await listFinancialCommitments(ownerA.id, organizationA.organizationId), []);
    assert.deepEqual(await listFinancialLedgerEntries(ownerA.id, organizationA.organizationId), []);
  } finally {
    await closeDatabaseForTests();
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.nodeEnv;
    if (previous.sqlitePath === undefined) delete process.env.SQLITE_DATABASE_PATH;
    else process.env.SQLITE_DATABASE_PATH = previous.sqlitePath;
    rmSync(directory, { recursive: true, force: true });
  }
});
