import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  closeDatabaseForTests,
  consumeMfaLoginChallenge,
  consumeMfaRecoveryCode,
  createMfaLoginChallenge,
  createUser,
  enableUserMfa,
  findActiveMfaLoginChallenge,
  getUserMfa,
  savePendingUserMfa,
} from "../lib/db.js";
import {
  decryptMfaSecret,
  encryptMfaSecret,
  hashMfaValue,
  normalizeRecoveryCode,
  totpCode,
  verifyTotp,
} from "../lib/mfa.js";

test("TOTP segue o vetor RFC e cifra o segredo com chave separada", () => {
  const previousKey = process.env.MFA_ENCRYPTION_KEY;
  process.env.MFA_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64");
  try {
    const rfcSeed = ["GEZD", "GNBV", "GY3T", "QOJQ", "GEZD", "GNBV", "GY3T", "QOJQ"].join("");
    assert.equal(totpCode(rfcSeed, 59_000), "287082");
    assert.equal(verifyTotp(rfcSeed, "287082", { timestamp: 59_000, window: 0 }), true);
    assert.equal(verifyTotp(rfcSeed, "287083", { timestamp: 59_000, window: 0 }), false);
    const encrypted = encryptMfaSecret(rfcSeed);
    assert.notEqual(encrypted, rfcSeed);
    assert.equal(decryptMfaSecret(encrypted), rfcSeed);
    assert.equal(normalizeRecoveryCode("abcd-1234-EF56-7890"), "ABCD1234EF567890");
  } finally {
    if (previousKey === undefined) delete process.env.MFA_ENCRYPTION_KEY; else process.env.MFA_ENCRYPTION_KEY = previousKey;
  }
});

test("MFA persiste ativação, recuperação e desafio consumível uma vez", async () => {
  const previous = { nodeEnv: process.env.NODE_ENV, sqlitePath: process.env.SQLITE_DATABASE_PATH, key: process.env.MFA_ENCRYPTION_KEY };
  const directory = mkdtempSync(join(tmpdir(), "candtech-mfa-"));
  process.env.NODE_ENV = "test";
  process.env.SQLITE_DATABASE_PATH = join(directory, "mfa.sqlite");
  process.env.MFA_ENCRYPTION_KEY = Buffer.alloc(32, 13).toString("base64");
  try {
    const user = await createUser({ name: "MFA", email: "mfa@test.local", passwordHash: "hash" });
    await savePendingUserMfa({ userId: user.id, encryptedSecret: encryptMfaSecret("JBSWY3DPEHPK3PXP"), expiresAt: new Date(Date.now() + 60_000) });
    const recovery = "ABCD1234EF567890";
    assert.equal(await enableUserMfa({ userId: user.id, recoveryCodeHashes: [hashMfaValue(recovery)] }), true);
    assert.ok((await getUserMfa(user.id)).enabled_at);
    assert.equal(await consumeMfaRecoveryCode({ userId: user.id, codeHash: hashMfaValue(recovery) }), true);
    assert.equal(await consumeMfaRecoveryCode({ userId: user.id, codeHash: hashMfaValue(recovery) }), false);

    const challenge = "challenge-value";
    const challengeHash = hashMfaValue(challenge);
    await createMfaLoginChallenge({ challengeHash, userId: user.id, expiresAt: new Date(Date.now() + 60_000) });
    assert.equal((await findActiveMfaLoginChallenge(challengeHash)).userId, user.id);
    assert.equal(await consumeMfaLoginChallenge(challengeHash), user.id);
    assert.equal(await consumeMfaLoginChallenge(challengeHash), null);
  } finally {
    await closeDatabaseForTests();
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.nodeEnv;
    if (previous.sqlitePath === undefined) delete process.env.SQLITE_DATABASE_PATH; else process.env.SQLITE_DATABASE_PATH = previous.sqlitePath;
    if (previous.key === undefined) delete process.env.MFA_ENCRYPTION_KEY; else process.env.MFA_ENCRYPTION_KEY = previous.key;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rotas privilegiadas exigem uma sessão confirmada por MFA", () => {
  const protectedFiles = [
    "app/api/admin/monitoring/route.js",
    "app/api/admin/overview/route.js",
    "app/api/admin/payments/[paymentId]/receipt/route.js",
    "app/api/admin/staff/route.js",
    "app/api/team/route.js",
    "app/api/team/jobs/route.js",
    "app/central/[accessKey]/page.js",
  ];
  for (const file of protectedFiles) {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    assert.match(source, /hasVerifiedMfa\s*\(/, `${file} precisa exigir MFA confirmado`);
  }
});
