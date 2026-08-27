import test from "node:test";
import assert from "node:assert/strict";
import { createDriveState, verifyDriveState } from "../lib/google-drive.js";

test("state do Drive permite retorno fixo ao estoque sem aceitar destino arbitrário", async () => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "drive-state-test-secret-with-more-than-32-chars";
  try {
    const state = await createDriveState(42, "https://candtech.test/api/google-drive/callback", null, "session-hash", "inventory", "Estoque agosto.xlsx");
    const verified = await verifyDriveState(state);
    assert.equal(verified.userId, 42);
    assert.equal(verified.historyId, null);
    assert.equal(verified.returnTo, "inventory");
    assert.equal(verified.sessionHash, "session-hash");
    assert.equal(verified.filename, "Estoque agosto.xlsx");

    const rejectedDestination = await verifyDriveState(
      await createDriveState(42, "https://candtech.test/api/google-drive/callback", null, "session-hash", "https://evil.test"),
    );
    assert.equal(rejectedDestination.returnTo, "");
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret;
  }
});
