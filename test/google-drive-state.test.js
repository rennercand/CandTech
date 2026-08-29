import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDatabaseForTests, createUser } from "../lib/db.js";
import { consumeDriveOAuthTransaction, createDriveState, googleAuthorizationUrl, verifyDriveState } from "../lib/google-drive.js";

test("state do Drive permite retorno fixo ao estoque sem aceitar destino arbitrário", async () => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "drive-state-test-secret-with-more-than-32-chars";
  try {
    const nonce = "n".repeat(43);
    const state = await createDriveState(42, "https://candtech.test/api/google-drive/callback", null, "session-hash", "inventory", "Estoque agosto.xlsx", nonce);
    const verified = await verifyDriveState(state);
    assert.equal(verified.userId, 42);
    assert.equal(verified.historyId, null);
    assert.equal(verified.returnTo, "inventory");
    assert.equal(verified.sessionHash, "session-hash");
    assert.equal(verified.filename, "Estoque agosto.xlsx");
    assert.equal(verified.nonce, nonce);

    const rejectedDestination = await verifyDriveState(
      await createDriveState(42, "https://candtech.test/api/google-drive/callback", null, "session-hash", "https://evil.test", "", "m".repeat(43)),
    );
    assert.equal(rejectedDestination.returnTo, "");
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret;
  }
});

test("OAuth do Drive usa PKCE e consome a transação somente uma vez", async () => {
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    sqlitePath: process.env.SQLITE_DATABASE_PATH,
    jwt: process.env.JWT_SECRET,
    oauth: process.env.OAUTH_STATE_SECRET,
    encryption: process.env.DRIVE_TOKEN_ENCRYPTION_KEY,
    clientId: process.env.GOOGLE_CLIENT_ID,
  };
  const directory = mkdtempSync(join(tmpdir(), "candtech-drive-oauth-"));
  process.env.NODE_ENV = "test";
  process.env.SQLITE_DATABASE_PATH = join(directory, "oauth.sqlite");
  process.env.JWT_SECRET = "drive-session-test-secret-with-more-than-32-chars";
  process.env.OAUTH_STATE_SECRET = "drive-state-test-secret-with-more-than-32-chars";
  process.env.DRIVE_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.GOOGLE_CLIENT_ID = "google-client.test";
  try {
    const user = await createUser({ name: "Drive", email: "drive@test.local", passwordHash: "hash" });
    const authorizationUrl = await googleAuthorizationUrl({
      userId: user.id, redirectUri: "https://candtech.test/api/google-drive/callback",
      historyId: "123e4567-e89b-12d3-a456-426614174000", sessionHash: "session-hash",
    });
    assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
    assert.match(authorizationUrl.searchParams.get("code_challenge"), /^[A-Za-z0-9_-]{43}$/);
    const verified = await verifyDriveState(authorizationUrl.searchParams.get("state"));
    assert.equal(await consumeDriveOAuthTransaction({ nonce: verified.nonce, userId: user.id, sessionHash: "wrong-session" }), null);
    const verifier = await consumeDriveOAuthTransaction({ nonce: verified.nonce, userId: user.id, sessionHash: "session-hash" });
    assert.match(verifier, /^[A-Za-z0-9_-]{64}$/);
    assert.equal(await consumeDriveOAuthTransaction({ nonce: verified.nonce, userId: user.id, sessionHash: "session-hash" }), null);
  } finally {
    await closeDatabaseForTests();
    for (const [key, value] of Object.entries(previous)) {
      const envName = { nodeEnv: "NODE_ENV", sqlitePath: "SQLITE_DATABASE_PATH", jwt: "JWT_SECRET", oauth: "OAUTH_STATE_SECRET", encryption: "DRIVE_TOKEN_ENCRYPTION_KEY", clientId: "GOOGLE_CLIENT_ID" }[key];
      if (value === undefined) delete process.env[envName]; else process.env[envName] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
