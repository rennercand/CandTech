"use client";

import { useMemo } from "react";
import {
  summarizeAccounts,
  summarizeInventory,
  summarizeOrders,
} from "../lib/business-calculations";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const emptyFinancialAccount = () => ({
  id: "", type: "pagar", description: "", party: "", category: "Geral",
  dueDate: "", amount: "", status: "pendente",
});
export const emptyInventoryState = () => ({
  products: [{ id: "", name: "", sku: "", quantity: "", minimum: "", unitCost: "", location: "" }],
  deliveries: [{ id: "", description: "", partner: "", direction: "saida", date: "", status: "preparando", tracking: "" }],
});
export const emptyCommerceOrder = () => ({
  id: "", type: "venda", number: "", partner: "", contact: "", date: "",
  dueDate: "", amount: "", status: "rascunho",
});

function Summary({ items }) {
  return <div className="stats-grid operations-summary">{items.map((item) => (
    <article className="stat-card" key={item.label}><span>{item.label}</span><strong>{item.value}</strong><small>{item.caption}</small></article>
  ))}</div>;
}

function Field({ label, children }) {
  return <label className="operation-field"><span>{label}</span>{children}</label>;
}

export function FinancialCommitments({ accounts, setAccounts }) {
  const summary = useMemo(() => summarizeAccounts(accounts), [accounts]);
  const update = (index, field, value) => setAccounts((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
  const remove = (index) => setAccounts((current) => current.filter((_, rowIndex) => rowIndex !== index));
  return <section className="panel operations-panel">
    <div className="panel-heading"><div><span className="eyebrow">COMPROMISSOS</span><h2>Contas a pagar e receber</h2><p>Acompanhe vencimentos sem misturar valores previstos com o caixa já realizado.</p></div><button className="primary-button" onClick={() => setAccounts((current) => [...current, { ...emptyFinancialAccount(), id: newId() }])}>+ Nova conta</button></div>
    <Summary items={[
      { label: "A receber", value: money.format(summary.receivable), caption: "Valores ainda pendentes" },
      { label: "A pagar", value: money.format(summary.payable), caption: "Obrigações ainda pendentes" },
      { label: "Vencidas", value: summary.overdue, caption: "Itens que pedem atenção" },
    ]} />
    <div className="operation-list">{accounts.map((account, index) => <article className="operation-row" key={account.id || `account-${index}`}>
      <Field label="Tipo"><select value={account.type} onChange={(e) => update(index, "type", e.target.value)}><option value="pagar">A pagar</option><option value="receber">A receber</option></select></Field>
      <Field label="Descrição"><input value={account.description} onChange={(e) => update(index, "description", e.target.value)} placeholder="Ex.: aluguel" /></Field>
      <Field label="Cliente / fornecedor"><input value={account.party} onChange={(e) => update(index, "party", e.target.value)} placeholder="Nome" /></Field>
      <Field label="Categoria"><input value={account.category} onChange={(e) => update(index, "category", e.target.value)} /></Field>
      <Field label="Vencimento"><input type="date" value={account.dueDate} onChange={(e) => update(index, "dueDate", e.target.value)} /></Field>
      <Field label="Valor"><input type="number" min="0" step="0.01" value={account.amount} onChange={(e) => update(index, "amount", e.target.value)} placeholder="0,00" /></Field>
      <Field label="Status"><select value={account.status} onChange={(e) => update(index, "status", e.target.value)}><option value="pendente">Pendente</option><option value={account.type === "pagar" ? "pago" : "recebido"}>{account.type === "pagar" ? "Pago" : "Recebido"}</option></select></Field>
      <button className="remove-row" onClick={() => remove(index)} aria-label="Excluir conta">×</button>
    </article>)}</div>
    {!accounts.length && <p className="empty-state">Nenhuma conta cadastrada. Use “Nova conta” para começar.</p>}
    <p className="responsibility-note">Marcar uma conta como paga ou recebida não cria um movimento no fluxo de caixa automaticamente. Isso evita lançamentos duplicados e mantém a conciliação sob seu controle.</p>
  </section>;
}

export function InventoryLogistics({ state, setState }) {
  const summary = useMemo(() => summarizeInventory(state), [state]);
  const update = (group, index, field, value) => setState((current) => ({ ...current, [group]: current[group].map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row) }));
  const add = (group, row) => setState((current) => ({ ...current, [group]: [...current[group], { ...row, id: newId() }] }));
  const remove = (group, index) => setState((current) => ({ ...current, [group]: current[group].filter((_, rowIndex) => rowIndex !== index) }));
  return <div className="business-stack">
    <Summary items={[
      { label: "Itens em estoque", value: summary.units, caption: `${summary.skus} produtos cadastrados` },
      { label: "Valor estimado", value: money.format(summary.value), caption: "Quantidade × custo unitário" },
      { label: "Estoque baixo", value: summary.lowStock, caption: "No mínimo ou abaixo dele" },
      { label: "Entregas abertas", value: summary.openDeliveries, caption: `${summary.lateDeliveries} atrasadas` },
    ]} />
    <section className="panel operations-panel"><div className="panel-heading"><div><span className="eyebrow">ESTOQUE</span><h2>Produtos e quantidades</h2><p>O valor é estimado pelo custo unitário informado, sem alterar dados financeiros.</p></div><button className="primary-button" onClick={() => add("products", { name: "", sku: "", quantity: "", minimum: "", unitCost: "", location: "" })}>+ Produto</button></div>
      <div className="operation-list">{state.products.map((product, index) => <article className="operation-row product-row" key={product.id || `product-${index}`}>
        <Field label="Produto"><input value={product.name} onChange={(e) => update("products", index, "name", e.target.value)} placeholder="Nome do produto" /></Field><Field label="SKU / código"><input value={product.sku} onChange={(e) => update("products", index, "sku", e.target.value)} /></Field><Field label="Quantidade"><input type="number" min="0" value={product.quantity} onChange={(e) => update("products", index, "quantity", e.target.value)} /></Field><Field label="Estoque mínimo"><input type="number" min="0" value={product.minimum} onChange={(e) => update("products", index, "minimum", e.target.value)} /></Field><Field label="Custo unitário"><input type="number" min="0" step="0.01" value={product.unitCost} onChange={(e) => update("products", index, "unitCost", e.target.value)} /></Field><Field label="Localização"><input value={product.location} onChange={(e) => update("products", index, "location", e.target.value)} placeholder="Ex.: corredor A" /></Field><button className="remove-row" onClick={() => remove("products", index)} aria-label="Excluir produto">×</button>
      </article>)}</div>
    </section>
    <section className="panel operations-panel"><div className="panel-heading"><div><span className="eyebrow">LOGÍSTICA</span><h2>Controle de entregas</h2><p>Registre entradas e saídas, responsáveis e códigos de rastreio.</p></div><button className="primary-button" onClick={() => add("deliveries", { description: "", partner: "", direction: "saida", date: "", status: "preparando", tracking: "" })}>+ Entrega</button></div>
      <div className="operation-list">{state.deliveries.map((delivery, index) => <article className="operation-row delivery-row" key={delivery.id || `delivery-${index}`}>
        <Field label="Movimento"><select value={delivery.direction} onChange={(e) => update("deliveries", index, "direction", e.target.value)}><option value="saida">Saída</option><option value="entrada">Entrada</option></select></Field><Field label="Descrição"><input value={delivery.description} onChange={(e) => update("deliveries", index, "description", e.target.value)} /></Field><Field label="Cliente / fornecedor"><input value={delivery.partner} onChange={(e) => update("deliveries", index, "partner", e.target.value)} /></Field><Field label="Previsão"><input type="date" value={delivery.date} onChange={(e) => update("deliveries", index, "date", e.target.value)} /></Field><Field label="Status"><select value={delivery.status} onChange={(e) => update("deliveries", index, "status", e.target.value)}><option value="preparando">Preparando</option><option value="em-transito">Em trânsito</option><option value="entregue">Entregue</option><option value="cancelada">Cancelada</option></select></Field><Field label="Rastreio"><input value={delivery.tracking} onChange={(e) => update("deliveries", index, "tracking", e.target.value)} /></Field><button className="remove-row" onClick={() => remove("deliveries", index)} aria-label="Excluir entrega">×</button>
      </article>)}</div>
    </section>
  </div>;
}

export function SalesPurchases({ orders, setOrders }) {
  const summary = useMemo(() => summarizeOrders(orders), [orders]);
  const update = (index, field, value) => setOrders((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
  return <div className="business-stack"><Summary items={[
    { label: "Pedidos de venda", value: money.format(summary.sales), caption: "Exceto pedidos cancelados" },
    { label: "Pedidos de compra", value: money.format(summary.purchases), caption: "Exceto pedidos cancelados" },
    { label: "Saldo dos pedidos", value: money.format(summary.balance), caption: "Vendas menos compras" },
    { label: "Fornecedores", value: summary.suppliers.size, caption: `${summary.overdue} pedidos vencidos` },
  ]} />
  <section className="panel operations-panel"><div className="panel-heading"><div><span className="eyebrow">COMERCIAL</span><h2>Pedidos, clientes e fornecedores</h2><p>Contato e situação do pedido ficam juntos para facilitar o acompanhamento.</p></div><button className="primary-button" onClick={() => setOrders((current) => [...current, { ...emptyCommerceOrder(), id: newId() }])}>+ Novo pedido</button></div>
    <div className="operation-list">{orders.map((order, index) => <article className="operation-row order-row" key={order.id || `order-${index}`}>
      <Field label="Tipo"><select value={order.type} onChange={(e) => update(index, "type", e.target.value)}><option value="venda">Venda</option><option value="compra">Compra</option></select></Field><Field label="Pedido"><input value={order.number} onChange={(e) => update(index, "number", e.target.value)} placeholder="Nº ou referência" /></Field><Field label={order.type === "compra" ? "Fornecedor" : "Cliente"}><input value={order.partner} onChange={(e) => update(index, "partner", e.target.value)} /></Field><Field label="Contato"><input value={order.contact} onChange={(e) => update(index, "contact", e.target.value)} placeholder="E-mail ou telefone" /></Field><Field label="Data"><input type="date" value={order.date} onChange={(e) => update(index, "date", e.target.value)} /></Field><Field label="Prazo"><input type="date" value={order.dueDate} onChange={(e) => update(index, "dueDate", e.target.value)} /></Field><Field label="Valor"><input type="number" min="0" step="0.01" value={order.amount} onChange={(e) => update(index, "amount", e.target.value)} /></Field><Field label="Status"><select value={order.status} onChange={(e) => update(index, "status", e.target.value)}><option value="rascunho">Rascunho</option><option value="confirmado">Confirmado</option><option value="concluido">Concluído</option><option value="cancelado">Cancelado</option></select></Field><button className="remove-row" onClick={() => setOrders((current) => current.filter((_, rowIndex) => rowIndex !== index))} aria-label="Excluir pedido">×</button>
    </article>)}</div>
    {!orders.length && <p className="empty-state">Nenhum pedido cadastrado.</p>}
    <p className="responsibility-note">Os totais representam pedidos registrados, não faturamento realizado. Movimentos reais devem ser conciliados no módulo Financeiro.</p>
  </section></div>;
}
