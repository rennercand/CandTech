import test from "node:test";
import assert from "node:assert/strict";
import { pixAmounts } from "../lib/pix.js";
import { SUBSCRIPTION_PRICING } from "../lib/subscription-pricing.js";

test("preço público e Pix coincidem mesmo com variáveis antigas na hospedagem", () => {
  const keys = ["PIX_MONTHLY_AMOUNT_CENTS", "PIX_SETUP_AMOUNT_CENTS"];
  const previous = keys.map(key => process.env[key]);
  try {
    process.env.PIX_MONTHLY_AMOUNT_CENTS = "6000";
    process.env.PIX_SETUP_AMOUNT_CENTS = "12000";
    const amounts = pixAmounts();
    assert.equal(amounts.monthly, 8000);
    assert.equal(amounts.monthly + amounts.setup, 12000);
    assert.equal(amounts.monthly, SUBSCRIPTION_PRICING.monthly);
    assert.equal(amounts.monthly + amounts.setup, SUBSCRIPTION_PRICING.firstMonth);
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
});
