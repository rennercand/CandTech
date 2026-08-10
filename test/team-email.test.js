import assert from "node:assert/strict";
import test from "node:test";

import { sendTeamInvitation } from "../lib/team-email.js";

test("e-mail de convite informa cargo, permissões e usa envio idempotente", async () => {
  const previousKey = process.env.RESEND_API_KEY;
  const previousFrom = process.env.TEAM_INVITE_FROM;
  const previousFetch = global.fetch;
  let request;
  process.env.RESEND_API_KEY = "re_test";
  process.env.TEAM_INVITE_FROM = "CandTech <convites@candtech.com.br>";
  global.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
  };
  try {
    const result = await sendTeamInvitation({
      to: "pessoa@empresa.test",
      organizationName: "Loja <Teste>",
      inviterName: "Renner",
      jobTitle: "Vendedor",
      permissionLabels: ["Vendas e compras", "Estoque e logística"],
      inviteUrl: "https://candtech.com.br/#invite=seguro",
      invitationId: 42,
    });
    const body = JSON.parse(request.options.body);
    assert.equal(result.sent, true);
    assert.equal(request.url, "https://api.resend.com/emails");
    assert.equal(request.options.headers["Idempotency-Key"], "team-invitation-42");
    assert.match(body.subject, /Vendedor/);
    assert.match(body.html, /Vendas e compras/);
    assert.match(body.html, /Aceitar convite/);
    assert.doesNotMatch(body.html, /Loja <Teste>/);
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousKey;
    if (previousFrom === undefined) delete process.env.TEAM_INVITE_FROM;
    else process.env.TEAM_INVITE_FROM = previousFrom;
  }
});
