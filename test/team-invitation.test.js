import assert from "node:assert/strict";
import test from "node:test";
import { maskInvitationEmail, publicInvitationPreview, validInvitationToken } from "../lib/team-invitation.js";

test("prévia pública do convite mascara o e-mail e expõe somente contexto necessário", () => {
  const preview = publicInvitationPreview({
    organization_name: "Loja Exemplo",
    inviter_name: "Responsável",
    email: "funcionario@exemplo.com.br",
    job_title: "Vendedor",
    permissions: ["commerce", "inventory"],
    expires_at: "2026-08-10T12:00:00.000Z",
    id: 91,
    organization_id: 52,
  });

  assert.equal(preview.maskedEmail, "fu********@exemplo.com.br");
  assert.equal(preview.organizationName, "Loja Exemplo");
  assert.equal(preview.jobTitle, "Vendedor");
  assert.deepEqual(preview.permissionLabels, ["Logística e estoque", "Pedidos e vendas"]);
  assert.equal("email" in preview, false);
  assert.equal("id" in preview, false);
  assert.equal("organizationId" in preview, false);
});

test("token do convite mantém formato de alta entropia", () => {
  assert.equal(validInvitationToken("a".repeat(43)), true);
  assert.equal(validInvitationToken("curto"), false);
  assert.equal(validInvitationToken("a".repeat(42) + "."), false);
  assert.equal(maskInvitationEmail("a@empresa.com"), "a***@empresa.com");
});
