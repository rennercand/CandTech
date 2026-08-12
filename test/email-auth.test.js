import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import bcrypt from "bcryptjs";
import {
  closeDatabaseForTests, consumeEmailVerificationToken, createAuthActionToken,
  createAuthSession, createUser, findActiveAuthSession, findUserByEmail, resetPasswordWithToken,
} from "../lib/db.js";

test("confirmação de e-mail e recuperação usam tokens únicos, expiráveis e revogam sessões", async () => {
  const directory = mkdtempSync(join(tmpdir(), "candtech-email-auth-"));
  const previousEnvironment = process.env.NODE_ENV;
  const previousPath = process.env.SQLITE_DATABASE_PATH;
  process.env.NODE_ENV = "test";
  process.env.SQLITE_DATABASE_PATH = join(directory, "auth.sqlite");
  try {
    const acceptedAt = new Date().toISOString();
    const user = await createUser({
      name: "Cliente", email: "cliente@email.test", passwordHash: "hash-antigo",
      legalAcceptance: { acceptedAt, termsVersion: "2026-08-11.2", privacyVersion: "2026-08-11.2" },
    });
    assert.equal(user.email_verification_required, 1);
    const storedUser = await findUserByEmail(user.email);
    assert.equal(storedUser.legal_accepted_at, acceptedAt);
    assert.equal(storedUser.terms_version, "2026-08-11.2");
    assert.equal(storedUser.privacy_version, "2026-08-11.2");

    await createAuthActionToken({ userId: user.id, purpose: "verify_email", tokenHash: "hash-verificacao", expiresAt: new Date(Date.now() + 60_000) });
    const verified = await consumeEmailVerificationToken("hash-verificacao");
    assert.equal(verified.email_verification_required, 0);
    assert.ok(verified.email_verified_at);
    assert.equal(await consumeEmailVerificationToken("hash-verificacao"), null, "token não pode ser reutilizado");

    await createAuthActionToken({ userId: user.id, purpose: "verify_email", tokenHash: "hash-expirado", expiresAt: new Date(Date.now() - 1_000) });
    assert.equal(await consumeEmailVerificationToken("hash-expirado"), null, "token expirado deve ser rejeitado");

    await createAuthSession({ sessionHash: "sessao-antiga", userId: user.id, expiresAt: new Date(Date.now() + 60_000) });
    await createAuthActionToken({ userId: user.id, purpose: "reset_password", tokenHash: "hash-reset", expiresAt: new Date(Date.now() + 60_000) });
    const passwordHash = await bcrypt.hash("nova-senha-segura", 4);
    assert.ok(await resetPasswordWithToken({ tokenHash: "hash-reset", passwordHash }));
    assert.equal(await findActiveAuthSession("sessao-antiga"), null, "troca deve encerrar sessões existentes");
    assert.equal(await resetPasswordWithToken({ tokenHash: "hash-reset", passwordHash }), null, "reset não pode ser repetido");
    assert.equal(await bcrypt.compare("nova-senha-segura", (await findUserByEmail(user.email)).password_hash), true);
  } finally {
    await closeDatabaseForTests();
    if (previousEnvironment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnvironment;
    if (previousPath === undefined) delete process.env.SQLITE_DATABASE_PATH; else process.env.SQLITE_DATABASE_PATH = previousPath;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("e-mail de conta é normalizado e não pode ser cadastrado novamente", async () => {
  const directory = mkdtempSync(join(tmpdir(), "candtech-unique-email-"));
  const previousEnvironment = process.env.NODE_ENV;
  const previousPath = process.env.SQLITE_DATABASE_PATH;
  process.env.NODE_ENV = "test";
  process.env.SQLITE_DATABASE_PATH = join(directory, "unique-email.sqlite");
  try {
    const first = await createUser({ name: "Primeira conta", email: "  Pessoa@Exemplo.COM  ", passwordHash: "hash" });
    assert.equal(first.email, "pessoa@exemplo.com");
    assert.equal((await findUserByEmail(" PESSOA@EXEMPLO.COM ")).id, first.id);
    await assert.rejects(
      () => createUser({ name: "Conta repetida", email: "pessoa@exemplo.com", passwordHash: "outro-hash" }),
      /UNIQUE/i,
    );
  } finally {
    await closeDatabaseForTests();
    if (previousEnvironment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnvironment;
    if (previousPath === undefined) delete process.env.SQLITE_DATABASE_PATH; else process.env.SQLITE_DATABASE_PATH = previousPath;
    rmSync(directory, { recursive: true, force: true });
  }
});
