import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBillingProfile, validCpf, validCnpj } from "../lib/profile-validation.js";

test("valida CPF e CNPJ e normaliza apenas dados cadastrais", () => {
  assert.equal(validCpf("529.982.247-25"), true);
  assert.equal(validCpf("111.111.111-11"), false);
  assert.equal(validCnpj("04.252.011/0001-10"), true);
  assert.equal(validCnpj("00.000.000/0000-00"), false);
  const profile = normalizeBillingProfile({ accountType: "person", legalName: "  Cliente Teste  ", state: "sp" });
  assert.equal(profile.legalName, "Cliente Teste");
  assert.equal(profile.state, "SP");
  assert.equal("taxId" in profile, false);
  assert.equal("cardNumber" in profile, false);
});
