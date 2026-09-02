import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDatabaseForTests, createUser, ensureOwnedOrganization, getDatabaseBackend } from "../lib/db.js";
import { getCashPosition, saveCashCount } from "../lib/cash-count-db.js";

test("conferência de caixa preserva histórico e calcula diferença contra o livro", async () => {
  const directory = mkdtempSync(join(tmpdir(), "candtech-cash-count-"));
  const previousEnvironment = process.env.NODE_ENV; const previousPath = process.env.SQLITE_DATABASE_PATH;
  process.env.NODE_ENV = "test"; process.env.SQLITE_DATABASE_PATH = join(directory, "cash.sqlite");
  try {
    const owner = await createUser({ name: "Caixa", email: "cash-count@test.local", passwordHash: "hash", accountType: "company" });
    const organization = await ensureOwnedOrganization({ userId: owner.id, name: "Caixa" });
    const date = "2026-09-01";
    assert.deepEqual(await getCashPosition({ ownerUserId: owner.id, organizationId: organization.organizationId, date }),
      { enabled: true, expected: 0, counted: null, difference: null, note: "", checkedAt: "" });
    const first = await saveCashCount({ ownerUserId: owner.id, organizationId: organization.organizationId, actorUserId: owner.id,
      date, counted: 20, note: "abertura" });
    assert.equal(first.difference, 20);
    const backend = await getDatabaseBackend();
    const account = backend.db.prepare("SELECT id FROM financial_accounts WHERE owner_user_id=? AND name='Caixa principal'").get(owner.id);
    backend.db.prepare(`INSERT INTO financial_ledger_entries(public_id,owner_user_id,organization_id,financial_account_id,direction,occurred_on,category,description,realized_amount)
      VALUES('entry-cash-count',?,?,?,'income',?,'Vendas','Venda',10)`).run(owner.id, organization.organizationId, account.id, date);
    const second = await saveCashCount({ ownerUserId: owner.id, organizationId: organization.organizationId, actorUserId: owner.id,
      date, counted: 10, note: "fechamento" });
    assert.equal(second.expected, 10); assert.equal(second.difference, 0); assert.equal(second.note, "fechamento");
    assert.equal(backend.db.prepare("SELECT COUNT(*) AS count FROM cash_counts").get().count, 2);
  } finally {
    await closeDatabaseForTests();
    if (previousEnvironment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnvironment;
    if (previousPath === undefined) delete process.env.SQLITE_DATABASE_PATH; else process.env.SQLITE_DATABASE_PATH = previousPath;
    rmSync(directory, { recursive: true, force: true });
  }
});
