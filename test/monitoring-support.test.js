import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  closeDatabaseForTests,
  createSupportTicket,
  createUser,
  listMonitoringEvents,
  listSupportTicketsForAdmin,
  listSupportTicketsForUser,
  recordMonitoringEvent,
  replySupportTicket,
  updateMonitoringEventStatus,
} from "../lib/db.js";
import { getMonitoringAccessPath, isAdministrator, isMonitoringAccessKey } from "../lib/admin-access.js";

const projectRoot = process.cwd();

async function isolatedDatabase(run) {
  const previousCwd = process.cwd();
  const previousEnvironment = process.env.NODE_ENV;
  const directory = mkdtempSync(join(tmpdir(), "candtech-monitoring-"));
  process.chdir(directory);
  process.env.NODE_ENV = "test";
  try { await run(); } finally {
    await closeDatabaseForTests();
    process.chdir(previousCwd);
    if (previousEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment;
    rmSync(directory, { recursive: true, force: true });
  }
}

test("monitoramento agrupa falhas repetidas e reabre incidente resolvido", async () => isolatedDatabase(async () => {
  const base = { fingerprint: "server:/api/example:save:Error", level: "error", source: "server", code: "server_operation_failed", summary: "Falha ao salvar.", route: "/api/example" };
  const first = await recordMonitoringEvent(base);
  await recordMonitoringEvent(base);
  let [event] = await listMonitoringEvents();
  assert.equal(event.id, first.id);
  assert.equal(event.occurrences, 2);
  await updateMonitoringEventStatus({ id: event.id, status: "resolved" });
  await recordMonitoringEvent(base);
  [event] = await listMonitoringEvents();
  assert.equal(event.status, "open");
  assert.equal(event.occurrences, 3);
}));

test("mensagens de suporte são privadas por usuário e o administrador pode responder", async () => isolatedDatabase(async () => {
  const userA = await createUser({ name: "Cliente A", email: "a@support.test", passwordHash: "hash" });
  const userB = await createUser({ name: "Cliente B", email: "b@support.test", passwordHash: "hash" });
  const ticket = await createSupportTicket({ userId: userA.id, subject: "Erro no estoque", message: "A tela não salvou o produto informado.", preferredChannel: "site" });
  assert.equal((await listSupportTicketsForUser(userA.id)).length, 1);
  assert.equal((await listSupportTicketsForUser(userB.id)).length, 0);
  assert.equal((await listSupportTicketsForAdmin())[0].requester.email, userA.email);
  await replySupportTicket({ id: ticket.id, reply: "Recebemos o chamado e já verificamos.", status: "answered" });
  const [answered] = await listSupportTicketsForUser(userA.id);
  assert.equal(answered.status, "answered");
  assert.match(answered.reply, /Recebemos/);
}));

test("acesso administrativo usa lista explícita e comparação normalizada", () => {
  const previous = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = "admin@candtech.com.br, Renner@Example.com ";
  try {
    assert.equal(isAdministrator("renner@example.com"), true);
    assert.equal(isAdministrator("cliente@example.com"), false);
  } finally {
    if (previous === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = previous;
  }
});

test("caminho do monitoramento não é fixo e exige a chave completa", () => {
  const previousSecret = process.env.JWT_SECRET;
  const previousSlug = process.env.ADMIN_MONITORING_SLUG;
  process.env.JWT_SECRET = "segredo-de-teste-com-entropia-suficiente";
  delete process.env.ADMIN_MONITORING_SLUG;
  try {
    const path = getMonitoringAccessPath();
    const key = path.split("/").at(-1);
    assert.match(path, /^\/central\/[A-Za-z0-9_-]{32}$/);
    assert.equal(isMonitoringAccessKey(key), true);
    assert.equal(isMonitoringAccessKey(`${key.slice(0, -1)}x`), false);
    assert.doesNotMatch(path, /monitoramento|admin/);
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret;
    if (previousSlug === undefined) delete process.env.ADMIN_MONITORING_SLUG; else process.env.ADMIN_MONITORING_SLUG = previousSlug;
  }
});

test("identificação administrativa não depende da assinatura do ERP", () => {
  const sessionRoute = readFileSync(join(projectRoot, "app", "api", "auth", "me", "route.js"), "utf8");
  const overviewRoute = readFileSync(join(projectRoot, "app", "api", "admin", "overview", "route.js"), "utf8");
  assert.match(sessionRoute, /const administrator = isAdministrator\(user\.email\)/);
  assert.match(sessionRoute, /monitoringPath:\s*administrator\s*\?\s*getMonitoringAccessPath\(\)\s*:\s*null/);
  assert.match(overviewRoute, /allowInactiveSubscription:\s*true/);
  assert.match(overviewRoute, /isAdministrator\(user\.email\)/);
});
