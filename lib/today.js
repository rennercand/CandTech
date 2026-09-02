const money = (value) => Math.round((Number(value) || 0) * 100) / 100;

function remaining(commitment) {
  const total = Number(commitment.amount || 0) + Number(commitment.interestAmount || 0)
    + Number(commitment.penaltyAmount || 0) - Number(commitment.discountAmount || 0);
  return money(Math.max(0, total - Number(commitment.paidAmount || 0)));
}

const dateOnly = (value) => String(value || "").slice(0, 10);
const urgency = (dueDate, today) => dueDate < today ? "danger" : dueDate === today ? "attention" : "neutral";

export function buildTodaySnapshot({ date, inventory = null, dailySales = null, services = null, commitments = null, cash = null }) {
  const groups = [];
  const summary = [];

  if (dailySales) {
    const sales = {
      count: Number(dailySales.count) || 0, gross: money(dailySales.gross), discounts: money(dailySales.discounts),
      total: money(dailySales.total), cost: money(dailySales.cost), margin: money(dailySales.margin), pending: Number(dailySales.pending) || 0,
    };
    summary.push({ id: "sales", label: "Vendas hoje", value: sales.count, amount: sales.total, tone: "positive", target: "commerce" });
    summary.push({ id: "margin", label: "Margem estimada", value: sales.count, amount: sales.margin,
      tone: sales.margin < 0 ? "danger" : "positive", target: "commerce" });
    if (sales.pending > 0) groups.push({ id: "sales-pending", title: "Vendas aguardando recebimento",
      description: `${sales.pending} ${sales.pending === 1 ? "venda foi registrada" : "vendas foram registradas"} a prazo hoje.`,
      tone: "attention", target: commitments ? "cashflow" : "commerce", action: commitments ? "Conferir contas" : "Abrir pedidos" });
  }

  if (commitments) {
    const due = commitments.filter((item) => ["pendente", "parcial"].includes(item.status) && item.dueDate && item.dueDate <= date)
      .map((item) => ({ id: item.id, title: item.description || (item.type === "receber" ? "Conta a receber" : "Conta a pagar"),
        detail: `${item.party || "Sem pessoa vinculada"} · ${item.dueDate < date ? "venceu" : "vence hoje"}`,
        amount: remaining(item), kind: item.type, dueDate: item.dueDate, tone: urgency(item.dueDate, date) }))
      .filter((item) => item.amount > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const receivable = money(due.filter((item) => item.kind === "receber").reduce((sum, item) => sum + item.amount, 0));
    const payable = money(due.filter((item) => item.kind === "pagar").reduce((sum, item) => sum + item.amount, 0));
    const overdue = due.filter((item) => item.dueDate < date).length;
    summary.push({ id: "receivable", label: "A receber vencido/hoje", value: due.filter((item) => item.kind === "receber").length,
      amount: receivable, tone: overdue ? "attention" : "neutral", target: "cashflow" });
    summary.push({ id: "payable", label: "A pagar vencido/hoje", value: due.filter((item) => item.kind === "pagar").length,
      amount: payable, tone: payable > receivable ? "danger" : "neutral", target: "cashflow" });
    if (due.length) groups.push({ id: "finance", title: overdue ? `${overdue} vencimento${overdue === 1 ? " atrasado" : "s atrasados"}` : "Vencimentos de hoje",
      description: "Dê baixa após confirmar o dinheiro no caixa ou no banco.", tone: overdue ? "danger" : "attention",
      target: "cashflow", action: "Abrir movimentações", items: due.slice(0, 12) });
  }

  if (cash) {
    const checked = cash.counted !== null;
    const difference = money(cash.difference);
    summary.push({ id: "cash", label: "Diferença de caixa", value: checked ? 1 : 0, amount: difference,
      tone: !checked ? "attention" : Math.abs(difference) >= 0.01 ? "danger" : "positive", target: "cashflow" });
    if (!checked) groups.push({ id: "cash", title: "Caixa ainda não conferido",
      description: `O saldo esperado é ${money(cash.expected).toFixed(2)}. Informe o saldo contado para detectar uma diferença real.`,
      tone: "attention", target: "cashflow", action: "Abrir movimentações" });
    else if (Math.abs(difference) >= 0.01) groups.push({ id: "cash", title: "Divergência de caixa",
      description: `O saldo contado difere do esperado em ${difference.toFixed(2)}. Revise recebimentos, pagamentos e estornos.`,
      tone: "danger", target: "cashflow", action: "Revisar lançamentos" });
  }

  if (inventory) {
    const low = inventory.products.flatMap((product) => product.variants
      .filter((variant) => Number(variant.quantity) <= Number(variant.minimumQuantity))
      .map((variant) => ({ id: variant.id, title: `${product.name} · ${variant.name}`, detail: `${variant.quantity} ${product.unit} disponíveis · mínimo ${variant.minimumQuantity}`,
        tone: Number(variant.quantity) <= 0 ? "danger" : "attention" })));
    const limit = new Date(`${date}T12:00:00`); limit.setDate(limit.getDate() + 30); const limitDate = limit.toISOString().slice(0, 10);
    const expiring = (inventory.lots || []).filter((lot) => lot.expires_on && dateOnly(lot.expires_on) <= limitDate)
      .map((lot) => ({ id: `${lot.variant_id}-${lot.lot_code}-${lot.expires_on}`, title: `${lot.product_name} · ${lot.variant_name}`,
        detail: `Lote ${lot.lot_code || "não informado"} · ${dateOnly(lot.expires_on) < date ? "vencido" : `vence em ${dateOnly(lot.expires_on)}`}`,
        tone: dateOnly(lot.expires_on) < date ? "danger" : "attention" }));
    summary.push({ id: "stock", label: "Reposição necessária", value: low.length, tone: low.some((item) => item.tone === "danger") ? "danger" : low.length ? "attention" : "positive", target: "inventory" });
    if (low.length || expiring.length) groups.push({ id: "inventory", title: "Exceções do estoque",
      description: `${low.length} para repor · ${expiring.length} lote${expiring.length === 1 ? "" : "s"} vencido${expiring.length === 1 ? "" : "s"} ou a vencer.`,
      tone: [...low, ...expiring].some((item) => item.tone === "danger") ? "danger" : "attention",
      target: "inventory", action: "Abrir estoque", items: [...low, ...expiring].slice(0, 12) });
  }

  if (services) {
    const active = services.filter((service) => !["completed", "cancelled"].includes(service.status));
    const todayServices = active.filter((service) => dateOnly(service.scheduledFor) === date);
    const late = active.filter((service) => service.scheduledFor && dateOnly(service.scheduledFor) < date);
    const unbilled = services.filter((service) => service.status === "completed" && Number(service.quotedAmount) > 0 && !service.billed);
    const items = [...late.map((service) => ({ ...service, todayTone: "danger", todayDetail: "Serviço atrasado" })),
      ...todayServices.map((service) => ({ ...service, todayTone: "attention", todayDetail: "Agendado para hoje" })),
      ...unbilled.map((service) => ({ ...service, todayTone: "danger", todayDetail: "Concluído sem conta a receber" }))]
      .filter((service, index, all) => all.findIndex((item) => item.id === service.id) === index)
      .map((service) => ({ id: service.id, title: service.title, detail: `${service.todayDetail}${service.assignee ? ` · ${service.assignee}` : ""}`,
        amount: money(service.quotedAmount), tone: service.todayTone }));
    summary.push({ id: "services", label: "Serviços hoje/atrasados", value: todayServices.length + late.length,
      amount: money([...todayServices, ...late].reduce((sum, service) => sum + Number(service.quotedAmount || 0), 0)),
      tone: late.length ? "danger" : todayServices.length ? "attention" : "positive", target: "services" });
    if (items.length) groups.push({ id: "services", title: late.length ? `${late.length} serviço${late.length === 1 ? " atrasado" : "s atrasados"}` : "Serviços para agir hoje",
      description: unbilled.length ? `${unbilled.length} conclusão sem cobrança também exige conferência.` : "Abra a ordem para avançar o status ou concluir a execução.",
      tone: late.length || unbilled.length ? "danger" : "attention", target: "services", action: "Abrir ordens", items: items.slice(0, 12) });
  }

  return { date, summary, groups, clear: groups.length === 0, cash };
}
