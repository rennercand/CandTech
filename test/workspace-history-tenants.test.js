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
  listHistories,
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

    await saveWorkspace({ userId: ownerA.id, organizationId: organizationA.organizationId, payload: { cashEntries: [{ description: "Privado A", amount: 50 }] } });
    assert.equal((await getWorkspace(ownerA.id, organizationA.organizationId)).payload.cashEntries[0].description, "Privado A");
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
    assert.deepEqual(exported.documents.map((item) => item.id), [history.id]);
  } finally {
    await closeDatabaseForTests();
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.nodeEnv;
    if (previous.sqlitePath === undefined) delete process.env.SQLITE_DATABASE_PATH;
    else process.env.SQLITE_DATABASE_PATH = previous.sqlitePath;
    rmSync(directory, { recursive: true, force: true });
  }
});
