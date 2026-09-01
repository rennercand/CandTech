// As permissões usam identificadores estáveis porque são gravadas no banco.
export const TEAM_AREAS = [
  { id: "dashboard", label: "Visão geral" },
  { id: "calculator", label: "Calculadoras" },
  { id: "financing", label: "Financiamentos" },
  { id: "pricing", label: "Preço do produto" },
  { id: "cashflow", label: "Movimentações" },
  { id: "inventory", label: "Logística e estoque" },
  { id: "commerce", label: "Pedidos e vendas" },
  { id: "discounts", label: "Conceder descontos" },
  { id: "clients", label: "Clientes" },
  { id: "tasks", label: "Tarefas" },
  { id: "services", label: "Ordens de serviço" },
  { id: "history", label: "Histórico" },
  { id: "exports", label: "Exportações" },
  { id: "drive", label: "Google Drive" },
];

export const ALL_TEAM_PERMISSIONS = TEAM_AREAS.map((area) => area.id);

export const ROLE_DEFAULTS = {
  manager: ALL_TEAM_PERMISSIONS,
  attendant: ["inventory", "commerce", "clients", "tasks", "services"],
};

export function normalizeRole(value) {
  return value === "manager" ? "manager" : "attendant";
}

export function normalizePermissions(value, role = "attendant") {
  const requested = Array.isArray(value) ? value : ROLE_DEFAULTS[normalizeRole(role)];
  return [...new Set(requested.filter((permission) => ALL_TEAM_PERMISSIONS.includes(permission)))];
}

export function hasPermission(access, permission) {
  if (!access) return false;
  if (["owner", "personal"].includes(access.role)) return true;
  return access.permissions.includes(permission);
}

export function permissionForView(view) {
  return {
    dashboard: "dashboard",
    calculator: "calculator",
    financing: "financing",
    pricing: "pricing",
    cashflow: "cashflow",
    inventory: "inventory",
    commerce: "commerce",
    clients: "clients",
    tasks: "tasks",
    services: "services",
    history: "history",
  }[view] || null;
}

export function permissionForCalculationType(type) {
  if (["VPL", "TIR", "Payback"].includes(type)) return "calculator";
  if (type === "tabela-financeira") return "financing";
  if (type === "preco-produto") return "pricing";
  if (["organizacao-financeira", "rascunho-automatico"].includes(type)) return "cashflow";
  if (type === "estoque-logistica") return "inventory";
  if (type === "vendas-compras") return "commerce";
  return null;
}

const WORKSPACE_KEYS = {
  calculator: ["inputs", "calculationType", "saveTitle"],
  financing: ["financeState", "savedFinancings"],
  pricing: ["pricingState"],
  cashflow: ["cashEntries", "cashFilters", "financialCategories", "financialCategoryRules", "organizationName", "financialAccounts"],
  inventory: ["inventoryState"],
  commerce: ["commerceOrders", "invoiceIssuer"],
  clients: ["clients"],
  tasks: ["tasks"],
};

function allowedWorkspaceKeys(access) {
  if (["owner", "personal"].includes(access?.role)) {
    return new Set(Object.values(WORKSPACE_KEYS).flat().concat("activeDocumentId"));
  }
  const keys = ["activeDocumentId"];
  for (const [permission, fields] of Object.entries(WORKSPACE_KEYS)) {
    if (hasPermission(access, permission)) keys.push(...fields);
  }
  return new Set(keys);
}

export function filterWorkspaceForAccess(payload = {}, access) {
  const allowed = allowedWorkspaceKeys(access);
  return Object.fromEntries(Object.entries(payload).filter(([key]) => allowed.has(key)));
}

export function mergeWorkspaceForAccess(current = {}, incoming = {}, access) {
  const allowed = allowedWorkspaceKeys(access);
  const merged = { ...current };
  for (const [key, value] of Object.entries(incoming || {})) {
    if (allowed.has(key)) merged[key] = value;
  }
  return merged;
}

export function filterHistoryForAccess(item, access) {
  if (!item) return null;
  const permission = permissionForCalculationType(item.calculation_type);
  if (!permission && !["owner", "personal"].includes(access?.role)) return null;
  if (permission && !hasPermission(access, permission)) return null;
  const payload = { ...(item.payload || {}) };
  if (payload.workspace) payload.workspace = filterWorkspaceForAccess(payload.workspace, access);
  return { ...item, payload };
}
