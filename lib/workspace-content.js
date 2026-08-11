// Uma conta empresarial automática só pode ser descartada ao aceitar convite
// quando não houver nenhum dado operacional real neste espaço.
export function hasMeaningfulWorkspaceContent(payload) {
  const inputs = payload?.inputs || {};
  const number = (value) => Number(value) || 0;
  const hasCalculation = number(inputs.investment) !== 0 || number(inputs.rate) !== 0 ||
    number(inputs.periods) > 0 || (inputs.flows || []).some((flow) => number(flow?.amount ?? flow) !== 0);
  const hasOrganization = (payload?.cashEntries || []).some((entry) => String(entry?.description || "").trim() || Number(entry?.amount) !== 0);
  const hasFinancialTable = Number(payload?.financeState?.form?.principal) > 0 && Number(payload?.financeState?.form?.periods) > 0;
  const hasAccounts = (payload?.financialAccounts || []).some((item) => String(item?.description || item?.party || "").trim() || Number(item?.amount) !== 0);
  const hasInventory = (payload?.inventoryState?.products || []).some((item) => String(item?.name || item?.sku || "").trim() || Number(item?.quantity) !== 0) ||
    (payload?.inventoryState?.deliveries || []).some((item) => String(item?.description || item?.tracking || "").trim());
  const hasCommerce = (payload?.commerceOrders || []).some((item) => String(item?.number || item?.partner || "").trim() || Number(item?.amount) !== 0);
  const hasClients = (payload?.clients || []).some((item) => String(item?.name || item?.email || item?.phone || "").trim());
  const hasTasks = (payload?.tasks || []).some((item) => String(item?.title || "").trim());
  return hasCalculation || hasOrganization || hasFinancialTable || hasAccounts || hasInventory || hasCommerce || hasClients || hasTasks;
}
