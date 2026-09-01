import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";

import { calculateAmortization, calculateProductPrice } from "../lib/finance-calculations.js";
import { historyCsv } from "../lib/history-csv.js";
import { historyXlsx } from "../lib/history-xlsx.js";
import { calculateInvestment } from "../lib/investment-calculations.js";
import { hasMeaningfulWorkspaceContent } from "../lib/workspace-content.js";
import {
  filterHistoryForAccess,
  filterWorkspaceForAccess,
  hasPermission,
  mergeWorkspaceForAccess,
  normalizePermissions,
} from "../lib/team-permissions.js";
import {
  acceptOrganizationInvitation,
  closeDatabaseForTests,
  createHistory,
  createOrganizationInvitation,
  createOrganizationJob,
  createUser,
  ensureOwnedOrganization,
  findHistoryById,
  findOrganizationJob,
  findOrganizationAccess,
  getWorkspace,
  listOrganizationTeam,
  removeOrganizationJob,
  saveWorkspace,
  updateOrganizationJob,
  updateOrganizationMember,
} from "../lib/db.js";

const closeTo = (actual, expected, tolerance = 0.01) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} deveria ser próximo de ${expected}`);

test("workspace vazio não é confundido com dados financeiros", () => {
  assert.equal(hasMeaningfulWorkspaceContent({}), false);
  assert.equal(hasMeaningfulWorkspaceContent({ cashEntries: [{ description: "Venda", amount: 10 }] }), true);
  assert.equal(hasMeaningfulWorkspaceContent({ clients: [{ name: "Cliente cadastrado" }] }), true);
  assert.equal(hasMeaningfulWorkspaceContent({ tasks: [{ title: "Confirmar entrega" }] }), true);
});

test("VPL coincide com o exemplo de referência do Excel", () => {
  const result = calculateInvestment({
    investment: 40_000,
    investmentDate: "2026-01-01",
    rate: 8,
    periods: 5,
    flows: [8_000, 9_200, 10_000, 12_000, 14_500].map((amount, index) => ({
      date: `202${7 + index}-01-01`,
      amount,
    })),
  });
  closeTo(result.npv, 1_922.06, 0.02);
});

test("TIR zera o VPL e coincide com o exemplo de referência", () => {
  const values = [12_000, 15_000, 18_000, 21_000, 26_000];
  const result = calculateInvestment({
    investment: 70_000,
    investmentDate: "2026-01-01",
    rate: 0,
    periods: values.length,
    flows: values.map((amount, index) => ({ date: `202${7 + index}-01-01`, amount })),
  });
  closeTo(result.irr, 8.66, 0.02);
});

test("ROI, índice de lucratividade e payback usam definições explícitas", () => {
  const result = calculateInvestment({
    investment: 100,
    investmentDate: "2026-01-01",
    rate: 10,
    periods: 3,
    flows: [30, 30, 80].map((amount, index) => ({
      date: `2026-0${index + 2}-01`,
      amount,
    })),
  });
  closeTo(result.roi, 40);
  closeTo(result.profitabilityIndex, 1.121712998, 1e-6);
  closeTo(result.payback, 2.5, 1e-9);
});

test("Price e SAF são equivalentes e liquidam o saldo", () => {
  const input = { principal: 10_000, rate: 1, periods: 12, startDate: "2026-01-31" };
  const price = calculateAmortization({ ...input, system: "PRICE" });
  const saf = calculateAmortization({ ...input, system: "SAF" });
  closeTo(price.firstPayment, 888.487887, 1e-6);
  closeTo(price.totalPaid, saf.totalPaid, 1e-8);
  closeTo(price.rows.at(-1).balance, 0, 1e-9);
  closeTo(price.rows.reduce((sum, row) => sum + row.amortization, 0), 10_000, 1e-6);
});

test("SAC mantém amortização constante e prestação decrescente", () => {
  const result = calculateAmortization({
    system: "SAC", principal: 1_200, rate: 1, periods: 12, startDate: "2026-01-31",
  });
  closeTo(result.firstPayment, 112);
  closeTo(result.lastPayment, 101);
  closeTo(result.totalInterest, 78);
  assert.equal(result.rows[1].date, "2026-02-28");
});

test("SAA paga juros periódicos e principal somente na última parcela", () => {
  const result = calculateAmortization({
    system: "SAA", principal: 1_200, rate: 1, periods: 12, startDate: "2026-01-31",
  });
  assert.equal(result.rows.slice(0, -1).every((row) => row.amortization === 0), true);
  closeTo(result.lastPayment, 1_212);
  closeTo(result.totalInterest, 144);
});

test("Preço por margem sobre venda reconcilia custo, lucro e faturamento", () => {
  const result = calculateProductPrice({
    expenses: [{ amount: 600 }, { amount: 400 }], units: 100, margin: 20,
  });
  closeTo(result.totalCost, 1_000);
  closeTo(result.unitCost, 10);
  closeTo(result.unitPrice, 12.5);
  closeTo(result.unitProfit, 2.5);
  closeTo(result.expectedRevenue, 1_250);
});

test("CSV e XLSX apresentam total gasto ao final da seção", () => {
  const item = {
    id: 1,
    title: "Auditoria",
    calculation_type: "VPL",
    created_at: "2026-08-01T00:00:00.000Z",
    payload: {
      table: [
        { period: 0, date: "2026-01-01", flow: -1_000 },
        { period: 1, date: "2026-02-01", flow: 600 },
      ],
    },
  };
  assert.match(historyCsv(item), /"Total gasto";-1000/);
  const files = unzipSync(new Uint8Array(historyXlsx(item)));
  const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
  const workbook = strFromU8(files["xl/workbook.xml"]);
  assert.match(sheet, /Total gasto/);
  assert.match(sheet, /SUMIF/);
  assert.match(workbook, /name="CandTech"/);
});

test("XLSX detalha itens, múltiplos financiamentos e resumo financeiro", () => {
  const first = calculateAmortization({ principal: 10_000, rate: 2, periods: 12, startDate: "2026-01-10", system: "PRICE" });
  const item = {
    id: 2,
    title: "Documento empresarial",
    calculation_type: "tabela-financeira",
    created_at: "2026-08-05T00:00:00.000Z",
    payload: {
      financialTables: [
        { id: "estoque", state: { system: "PRICE", form: { description: "Estoque SKU-A", principal: 10_000, rate: 2, periods: 12 } }, result: first },
        { id: "equipamento", state: { system: "SAC", form: { description: "Máquina de corte", principal: 5_000, rate: 1.5, periods: 6, startDate: "2026-02-10" } } },
      ],
      workspace: {
        inventoryState: { products: [{ name: "Produto A", sku: "SKU-A", quantity: 25, minimum: 5, unitCost: 40, location: "A1" }] },
        commerceOrders: [], cashEntries: [], pricingState: { expenses: [] }, savedFinancings: [],
      },
    },
  };
  const files = unzipSync(new Uint8Array(historyXlsx(item)));
  const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
  assert.match(sheet, /Resumo dos financiamentos/);
  assert.match(sheet, /Estoque SKU-A/);
  assert.match(sheet, /Máquina de corte/);
  assert.match(sheet, /Quantidade total de itens/);
  assert.match(sheet, /Total de juros/);
  assert.match(sheet, /Total pago em financiamentos/);
  assert.match(sheet, /Resumo final/);
});

test("CSV e XLSX identificam o produto e detalham seu custo", () => {
  const pricingState = {
    productName: "Camiseta premium",
    sku: "CAM-PRE-01",
    expenses: [{ name: "Tecido", amount: 600 }, { name: "Embalagem", amount: 400 }],
    units: 100,
    margin: 20,
  };
  const pricingResult = calculateProductPrice(pricingState);
  const item = {
    id: 3,
    title: "Preço do produto",
    calculation_type: "preco-produto",
    created_at: "2026-08-06T00:00:00.000Z",
    payload: { pricingState, pricingResult },
  };

  const csv = historyCsv(item);
  assert.match(csv, /Custo e preço do produto/);
  assert.match(csv, /Camiseta premium/);
  assert.match(csv, /CAM-PRE-01/);
  assert.match(csv, /Custo unitário/);

  const files = unzipSync(new Uint8Array(historyXlsx(item)));
  const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
  assert.match(sheet, /Custo e preço do produto/);
  assert.match(sheet, /Camiseta premium/);
  assert.match(sheet, /CAM-PRE-01/);
  assert.match(sheet, /Custo total do produto calculado/);
  assert.match(sheet, /Custo unitário do produto/);
});

test("atendente recebe somente as áreas explicitamente autorizadas", () => {
  const access = { role: "attendant", permissions: ["inventory", "commerce"] };
  const workspace = {
    inputs: { investment: 9000 },
    cashEntries: [{ description: "Saldo bancário", amount: 5000 }],
    inventoryState: { products: [{ name: "Produto", quantity: 2 }] },
    commerceOrders: [{ number: "PED-1", amount: 100 }],
  };
  assert.deepEqual(filterWorkspaceForAccess(workspace, access), {
    inventoryState: workspace.inventoryState,
    commerceOrders: workspace.commerceOrders,
  });
});

test("salvamento parcial não apaga áreas ocultas do espaço empresarial", () => {
  const access = { role: "attendant", permissions: ["inventory"] };
  const current = { cashEntries: [{ amount: 800 }], inventoryState: { products: [] } };
  const incoming = { cashEntries: [], inventoryState: { products: [{ name: "Novo" }] } };
  assert.deepEqual(mergeWorkspaceForAccess(current, incoming, access), {
    cashEntries: current.cashEntries,
    inventoryState: incoming.inventoryState,
  });
});

test("clientes e tarefas respeitam permissões independentes", () => {
  const workspace = {
    clients: [{ name: "Cliente visível" }],
    tasks: [{ title: "Tarefa oculta" }],
    commerceOrders: [{ number: "PED-1" }],
  };
  assert.deepEqual(filterWorkspaceForAccess(workspace, { role: "attendant", permissions: ["clients"] }), {
    clients: workspace.clients,
  });
  assert.deepEqual(filterWorkspaceForAccess(workspace, { role: "attendant", permissions: ["tasks"] }), {
    tasks: workspace.tasks,
  });
});

test("categorias financeiras seguem a permissão do painel financeiro", () => {
  const access = { role: "attendant", permissions: ["cashflow"] };
  const workspace = {
    financialCategories: ["Serviços recorrentes"],
    cashEntries: [{ description: "Mensalidade", amount: 200 }],
    inventoryState: { products: [{ name: "Produto oculto" }] },
  };

  assert.deepEqual(filterWorkspaceForAccess(workspace, access), {
    financialCategories: workspace.financialCategories,
    cashEntries: workspace.cashEntries,
  });
});

test("histórico e permissões desconhecidas são negados por padrão", () => {
  const access = { role: "attendant", permissions: normalizePermissions(["inventory", "area-inventada"], "attendant") };
  assert.deepEqual(access.permissions, ["inventory"]);
  assert.equal(filterHistoryForAccess({ calculation_type: "tabela-financeira", payload: {} }, access), null);
  assert.equal(filterHistoryForAccess({ calculation_type: "tipo-inventado", payload: {} }, access), null);
});

test("desconto no PDV exige permissão separada de vender", () => {
  assert.equal(hasPermission({ role: "attendant", permissions: ["commerce"] }, "discounts"), false);
  assert.equal(hasPermission({ role: "attendant", permissions: ["commerce", "discounts"] }, "discounts"), true);
  assert.equal(hasPermission({ role: "owner", permissions: [] }, "discounts"), true);
});

test("IDs de outra conta não permitem ler, sobrescrever ou administrar recursos", async () => {
  const previousCwd = process.cwd();
  const previousEnvironment = process.env.NODE_ENV;
  const directory = mkdtempSync(join(tmpdir(), "candtech-idor-"));
  process.chdir(directory);
  process.env.NODE_ENV = "test";
  try {
    const ownerA = await createUser({ name: "Empresa A", email: "a@idor.test", passwordHash: "hash", accountType: "company" });
    const ownerB = await createUser({ name: "Empresa B", email: "b@idor.test", passwordHash: "hash", accountType: "company" });
    const employeeB = await createUser({ name: "Funcionário B", email: "funcionario@idor.test", passwordHash: "hash" });
    const organizationA = await ensureOwnedOrganization({ userId: ownerA.id, name: "Empresa A" });
    const organizationB = await ensureOwnedOrganization({ userId: ownerB.id, name: "Empresa B" });
    await createOrganizationInvitation({
      organizationId: organizationB.organizationId, email: employeeB.email, role: "attendant",
      permissions: ["inventory"], tokenHash: "d".repeat(64), invitedBy: ownerB.id,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await acceptOrganizationInvitation({ tokenHash: "d".repeat(64), userId: employeeB.id, email: employeeB.email });

    const historyB = await createHistory({ userId: ownerB.id, title: "Privado B", calculationType: "investimento", payload: { secret: "B" } });
    assert.match(historyB.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(await findHistoryById(String(ownerB.id), ownerB.id), null);
    assert.equal(await findHistoryById(historyB.id, ownerA.id), null);
    await createHistory({ id: historyB.id, userId: ownerA.id, title: "Tentativa A", calculationType: "investimento", payload: { secret: "A" } });
    assert.equal((await findHistoryById(historyB.id, ownerB.id)).title, "Privado B");

    await saveWorkspace({ userId: ownerB.id, payload: { cashEntries: [{ description: "Privado B", amount: 10 }] } });
    assert.equal(await getWorkspace(ownerA.id), null);
    assert.equal(await updateOrganizationMember({
      organizationId: organizationA.organizationId, userId: employeeB.id, role: "manager", permissions: ["dashboard"],
    }), null);
    assert.equal((await findOrganizationAccess(employeeB.id)).organizationId, organizationB.organizationId);
  } finally {
    await closeDatabaseForTests();
    process.chdir(previousCwd);
    if (previousEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("convite empresarial vincula o funcionário sem transferir a propriedade", async () => {
  const previousCwd = process.cwd();
  const previousEnvironment = process.env.NODE_ENV;
  const directory = mkdtempSync(join(tmpdir(), "candtech-team-"));
  process.chdir(directory);
  process.env.NODE_ENV = "test";
  try {
    const owner = await createUser({ name: "Proprietário", email: "dono@empresa.test", passwordHash: "hash", accountType: "company" });
    const employee = await createUser({ name: "Atendente", email: "atendente@empresa.test", passwordHash: "hash", accountType: "person" });
    const organization = await ensureOwnedOrganization({ userId: owner.id, name: "Empresa Teste" });
    await createOrganizationInvitation({
      organizationId: organization.organizationId,
      email: employee.email,
      role: "attendant",
      jobTitle: "Estoquista",
      permissions: ["inventory", "commerce"],
      tokenHash: "a".repeat(64),
      invitedBy: owner.id,
      expiresAt: new Date(Date.now() + 60_000),
    });
    assert.equal(await acceptOrganizationInvitation({ tokenHash: "a".repeat(64), userId: employee.id, email: "errado@empresa.test" }), null);
    const access = await acceptOrganizationInvitation({ tokenHash: "a".repeat(64), userId: employee.id, email: employee.email });
    assert.equal(access.ownerUserId, owner.id);
    assert.equal(access.role, "attendant");
    assert.equal(access.jobTitle, "Estoquista");
    assert.deepEqual(access.permissions, ["inventory", "commerce"]);
    assert.equal((await findOrganizationAccess(owner.id)).role, "owner");
    const team = await listOrganizationTeam(organization.organizationId);
    assert.equal(team.members.length, 2);
    assert.equal(team.members.find((member) => member.id === employee.id).job_title, "Estoquista");
  } finally {
    await closeDatabaseForTests();
    process.chdir(previousCwd);
    if (previousEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("empresa cria cargos reutilizáveis e alterações atualizam os acessos vinculados", async () => {
  const previousCwd = process.cwd();
  const previousEnvironment = process.env.NODE_ENV;
  const directory = mkdtempSync(join(tmpdir(), "candtech-jobs-"));
  process.chdir(directory);
  process.env.NODE_ENV = "test";
  try {
    const owner = await createUser({ name: "Empresa", email: "dono@cargos.test", passwordHash: "hash", accountType: "company" });
    const employee = await createUser({ name: "Vendedor", email: "vendedor@cargos.test", passwordHash: "hash", accountType: "person" });
    const organization = await ensureOwnedOrganization({ userId: owner.id, name: "Loja de teste" });
    const job = await createOrganizationJob({
      organizationId: organization.organizationId,
      name: "Vendedor",
      role: "attendant",
      permissions: ["commerce", "inventory"],
    });
    assert.equal((await findOrganizationJob({ organizationId: organization.organizationId, jobId: job.id })).name, "Vendedor");
    await assert.rejects(
      createOrganizationJob({ organizationId: organization.organizationId, name: "vendedor", role: "manager", permissions: [] }),
      (error) => error.code === "JOB_ALREADY_EXISTS",
    );

    await createOrganizationInvitation({
      organizationId: organization.organizationId,
      email: employee.email,
      role: job.role,
      jobTitle: job.name,
      permissions: job.permissions,
      tokenHash: "e".repeat(64),
      invitedBy: owner.id,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await acceptOrganizationInvitation({ tokenHash: "e".repeat(64), userId: employee.id, email: employee.email });
    await updateOrganizationJob({
      organizationId: organization.organizationId,
      jobId: job.id,
      name: "Consultor de vendas",
      role: "manager",
      permissions: ["commerce", "cashflow"],
    });
    const team = await listOrganizationTeam(organization.organizationId);
    const updatedMember = team.members.find((member) => member.id === employee.id);
    assert.equal(updatedMember.job_title, "Consultor de vendas");
    assert.equal(updatedMember.role, "manager");
    assert.deepEqual(updatedMember.permissions, ["commerce", "cashflow"]);
    assert.equal(await removeOrganizationJob({ organizationId: organization.organizationId, jobId: job.id }), true);
    assert.equal((await listOrganizationTeam(organization.organizationId)).members.some((member) => member.id === employee.id), true);
  } finally {
    await closeDatabaseForTests();
    process.chdir(previousCwd);
    if (previousEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("conta empresarial existente só migra para uma equipe quando seu espaço automático está vazio", async () => {
  const previousCwd = process.cwd();
  const previousEnvironment = process.env.NODE_ENV;
  const directory = mkdtempSync(join(tmpdir(), "candtech-existing-team-"));
  process.chdir(directory);
  process.env.NODE_ENV = "test";
  try {
    const owner = await createUser({ name: "Empresa principal", email: "principal@empresa.test", passwordHash: "hash", accountType: "company" });
    const existing = await createUser({ name: "Conta empresarial vazia", email: "vazia@empresa.test", passwordHash: "hash", accountType: "company" });
    const organization = await ensureOwnedOrganization({ userId: owner.id, name: "Operação principal" });
    await ensureOwnedOrganization({ userId: existing.id, name: "Espaço automático vazio" });
    await createOrganizationInvitation({ organizationId: organization.organizationId, email: existing.email, role: "manager", jobTitle: "Gerente", permissions: ["dashboard"], tokenHash: "b".repeat(64), invitedBy: owner.id, expiresAt: new Date(Date.now() + 60_000) });
    const migrated = await acceptOrganizationInvitation({ tokenHash: "b".repeat(64), userId: existing.id, email: existing.email });
    assert.equal(migrated.organizationId, organization.organizationId);
    assert.equal(migrated.role, "manager");

    const protectedAccount = await createUser({ name: "Empresa com dados", email: "dados@empresa.test", passwordHash: "hash", accountType: "company" });
    await ensureOwnedOrganization({ userId: protectedAccount.id, name: "Empresa com dados" });
    await saveWorkspace({ userId: protectedAccount.id, payload: { cashEntries: [{ description: "Venda existente", amount: 100, type: "entrada" }] } });
    await createOrganizationInvitation({ organizationId: organization.organizationId, email: protectedAccount.email, role: "attendant", permissions: ["commerce"], tokenHash: "c".repeat(64), invitedBy: owner.id, expiresAt: new Date(Date.now() + 60_000) });
    await assert.rejects(
      acceptOrganizationInvitation({ tokenHash: "c".repeat(64), userId: protectedAccount.id, email: protectedAccount.email }),
      (error) => error.code === "OWNED_ORGANIZATION_NOT_EMPTY",
    );
    assert.equal((await findOrganizationAccess(protectedAccount.id)).role, "owner");

    const configuredAccount = await createUser({ name: "Empresa com cargos", email: "cargos@empresa.test", passwordHash: "hash", accountType: "company" });
    const configuredOrganization = await ensureOwnedOrganization({ userId: configuredAccount.id, name: "Empresa com cargos" });
    await createOrganizationJob({ organizationId: configuredOrganization.organizationId, name: "Caixa", role: "attendant", permissions: ["commerce"] });
    await createOrganizationInvitation({ organizationId: organization.organizationId, email: configuredAccount.email, role: "attendant", permissions: ["commerce"], tokenHash: "f".repeat(64), invitedBy: owner.id, expiresAt: new Date(Date.now() + 60_000) });
    await assert.rejects(
      acceptOrganizationInvitation({ tokenHash: "f".repeat(64), userId: configuredAccount.id, email: configuredAccount.email }),
      (error) => error.code === "OWNED_ORGANIZATION_NOT_EMPTY",
    );
    assert.equal((await findOrganizationAccess(configuredAccount.id)).organizationId, configuredOrganization.organizationId);
  } finally {
    await closeDatabaseForTests();
    process.chdir(previousCwd);
    if (previousEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment;
    rmSync(directory, { recursive: true, force: true });
  }
});
