import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("central monta apenas o portal autorizado e delega a visão geral com permissões", () => {
  const page = readFileSync(new URL("../app/central/[accessKey]/page.js", import.meta.url), "utf8");
  const portal = readFileSync(new URL("../app/admin/monitoramento/portal.js", import.meta.url), "utf8");
  const overview = readFileSync(new URL("../app/admin/monitoramento/system-overview-panel.js", import.meta.url), "utf8");
  assert.ok(!page.includes("SystemOverviewPanel"), "evita montagem duplicada sem propriedades");
  assert.match(page, /<MonitoringPortal administratorName=\{user.name\} permissions=\{access\}/);
  assert.match(portal, /<SystemOverviewPanel permissions=\{permissions\} onNavigate=\{setView\}/);
  assert.match(overview, /permissions = \{\}/);
  for (const guard of ["isMonitoringAccessKey(accessKey)", "getSession", "!access.isStaff", "!hasVerifiedMfa(user)"]) assert.ok(page.includes(guard));
});
