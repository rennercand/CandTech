import test from "node:test";
import assert from "node:assert/strict";
import { getCommercialReadiness } from "../lib/commercial-readiness.js";

const key32 = Buffer.alloc(32, 7).toString("base64");

test("prontidão comercial aprova o essencial sem devolver nenhum segredo", () => {
  const env = {
    DATABASE_URL: "postgres://private-user:private-password@example.test/db",
    JWT_SECRET: "jwt-private-secret-with-more-than-32-characters",
    MFA_ENCRYPTION_KEY: key32,
    BLOB_READ_WRITE_TOKEN: "vercel_blob_private_token",
    RESEND_API_KEY: "re_private_key",
    AUTH_EMAIL_FROM: "CandTech <nao-responda@example.test>",
    ADMIN_EMAILS: "owner@example.test",
    ADMIN_MONITORING_SLUG: "private-monitoring-slug-with-32-characters",
    CRON_SECRET: "private-cron-secret-with-more-than-32-characters",
    VERCEL_ENV: "production",
    PUBLIC_APP_URL: "https://www.candtech.com.br",
    OAUTH_STATE_SECRET: "oauth-private-secret-with-more-than-32-characters",
    NEXT_PUBLIC_SUPPORT_EMAIL: "suporte@example.test",
  };
  const result = getCommercialReadiness(env, { configured: true, configurationIssue: null });
  assert.equal(result.ready, true);
  assert.equal(result.blockers, 0);
  const serialized = JSON.stringify(result);
  for (const secret of [env.DATABASE_URL, env.JWT_SECRET, env.BLOB_READ_WRITE_TOKEN, env.RESEND_API_KEY, env.ADMIN_EMAILS, env.CRON_SECRET]) {
    assert.equal(serialized.includes(secret), false);
  }
});

test("prontidão comercial diferencia bloqueios de integrações opcionais", () => {
  const result = getCommercialReadiness({}, { configured: false, configurationIssue: "PIX_KEY_MISSING" });
  assert.equal(result.ready, false);
  assert.ok(result.blockers >= 8);
  assert.equal(result.checks.find((check) => check.id === "drive").status, "optional");
  assert.equal(result.checks.find((check) => check.id === "pix").blocking, true);
});
