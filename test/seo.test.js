import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { HOME_DESCRIPTION, HOME_META_TITLE, SITE_URL } from "../lib/site.js";

const projectRoot = process.cwd();

test("página inicial mantém os sinais essenciais verificados pelo Screaming Frog", () => {
  const publicHome = readFileSync(join(projectRoot, "app", "public-home.js"), "utf8");
  const page = readFileSync(join(projectRoot, "app", "page.js"), "utf8");

  assert.ok(HOME_META_TITLE.length >= 30 && HOME_META_TITLE.length <= 60);
  assert.ok(HOME_DESCRIPTION.length >= 120 && HOME_DESCRIPTION.length <= 160);
  assert.equal(SITE_URL, "https://www.candtech.com.br");
  assert.equal((publicHome.match(/<h1\b/g) || []).length, 1);
  assert.ok((publicHome.match(/<h2\b/g) || []).length >= 2);
  assert.ok((publicHome.match(/href="(?:\/|#)/g) || []).length >= 5);
  assert.match(page, /alternates:\s*\{ canonical: SITE_URL \}/);
});
