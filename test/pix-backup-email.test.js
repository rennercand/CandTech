import test from "node:test";
import assert from "node:assert/strict";
import { sendPixBackupEmail } from "../lib/billing-email.js";

test("backup de assinatura Pix usa destinatário verificado, anexo e idempotência", async () => {
  const previousFetch = global.fetch;
  const previousApiKey = process.env.RESEND_API_KEY;
  const previousSender = process.env.AUTH_EMAIL_FROM;
  let request;
  process.env.RESEND_API_KEY = "re_test_only";
  process.env.AUTH_EMAIL_FROM = "CandTech <acesso@candtech.com.br>";
  global.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200 };
  };

  try {
    const result = await sendPixBackupEmail({
      payment: {
        id: "payment-public-id",
        txid: "CTBACKUP1",
        customer: { name: "Cliente <Teste>", email: "cliente@teste.local" },
      },
      attachment: "UEsDBAoAAAAA",
    });
    assert.equal(result.sent, true);
    assert.equal(request.url, "https://api.resend.com/emails");
    assert.equal(request.options.headers["Idempotency-Key"], "pix-backup/payment-public-id");
    const body = JSON.parse(request.options.body);
    assert.deepEqual(body.to, ["cliente@teste.local"]);
    assert.equal(body.attachments[0].filename, "candtech-backup-payment-public-id.zip");
    assert.equal(body.attachments[0].content, "UEsDBAoAAAAA");
    assert.match(body.html, /Cliente &lt;Teste&gt;/);
  } finally {
    global.fetch = previousFetch;
    if (previousApiKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previousApiKey;
    if (previousSender === undefined) delete process.env.AUTH_EMAIL_FROM; else process.env.AUTH_EMAIL_FROM = previousSender;
  }
});
