"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ExpensePieChart,
  FinanceTables,
  ProductPricing,
  parseBankStatementPdf,
} from "./advanced-tools";
import { calculateAmortization, calculateProductPrice } from "../lib/finance-calculations";
import { calculateInvestment } from "../lib/investment-calculations";
import { commitmentAmounts, ordersFromCashEntries, suggestFinancialReconciliations } from "../lib/business-calculations";
import {
  FinancialCommitments,
  AdminOverview,
  emptyCommerceOrder,
  emptyFinancialAccount,
  emptyInventoryState,
} from "./business-tools";
import TeamAccess from "./team-access";
import InventoryOperations from "./inventory-operations";
import ClientManager from "./client-manager";
import TaskKanban from "./task-kanban";
import ServiceOperations from "./service-operations";
import TodayOperations from "./today-operations";
import SupportCenter from "./support-center";
import { trackMarketingEvent } from "../lib/analytics";
import FileNameDialog, { useFileNameDialog } from "./file-name-dialog";
import { markFinancialDuplicates, parseFinancialFile } from "../lib/financial-import";
import { normalizeCategoryRules, suggestCategory } from "../lib/financial-category-rules";

async function hydrateAuthenticatedUser() {
  const response = await fetch("/api/auth/me", { cache: "no-store" });
  const body = response.ok ? await response.json() : null;
  return body?.user || null;
}

async function acceptInvitation(inviteToken) {
  const response = await fetch("/api/team/invitation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: inviteToken }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Não foi possível aceitar o convite.");
  return body.access;
}

function invitationTokenFromLocation() {
  if (typeof window === "undefined") return "";
  const queryToken = new URLSearchParams(window.location.search).get("invite");
  const fragmentToken = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("invite");
  return fragmentToken || queryToken || "";
}

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const pct = (number) =>
  Number.isFinite(number) ? `${number.toFixed(2)}%` : "N/D";
const signedMoney = (value, type) => {
  const number = Math.abs(Number(value) || 0);
  return `${type === "entrada" ? "+" : "-"}${money.format(number)}`;
};
const formatDate = (value) => {
  if (!value) return "Sem data";
  // Evita que datas no formato AAAA-MM-DD mudem um dia por causa do fuso horário.
  const simpleDate = String(value).slice(0, 10).split("-");
  return simpleDate.length === 3
    ? `${simpleDate[2]}/${simpleDate[1]}/${simpleDate[0]}`
    : new Date(value).toLocaleDateString("pt-BR");
};
const today = () => new Date().toISOString().slice(0, 10);
const newWorkspaceEntityId = (prefix) => globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function projectedDate(index) {
  // Sugere uma data mensal para cada período, mas o usuário pode alterá-la.
  const base = new Date();
  const target = new Date(base.getFullYear(), base.getMonth() + index + 1, 1);
  const lastDay = new Date(
    target.getFullYear(),
    target.getMonth() + 1,
    0,
  ).getDate();
  target.setDate(Math.min(base.getDate(), lastDay));
  return target.toISOString().slice(0, 10);
}

function normalizeProjectionFlow(flow, index) {
  // Cálculos antigos guardavam apenas números; este formato mantém compatibilidade.
  if (flow && typeof flow === "object") {
    return {
      date: flow.date || projectedDate(index),
      amount: flow.amount ?? "",
    };
  }
  return { date: projectedDate(index), amount: flow ?? "" };
}

const blankCashRow = () => ({
  id: "",
  date: new Date().toISOString().slice(0, 10),
  category: "Geral",
  description: "",
  type: "entrada",
  amount: "",
});

const DEFAULT_FINANCIAL_CATEGORIES = [
  "Geral", "Vendas", "Compras", "Fornecedores", "Aluguel", "Impostos e taxas", "Salários", "Outros",
];

function normalizeFinancialCategories(payload = {}) {
  const values = [
    ...DEFAULT_FINANCIAL_CATEGORIES,
    ...(Array.isArray(payload.financialCategories) ? payload.financialCategories : []),
    ...(Array.isArray(payload.cashEntries) ? payload.cashEntries.map((entry) => entry?.category) : []),
    ...(Array.isArray(payload.financialAccounts) ? payload.financialAccounts.map((account) => account?.category) : []),
  ];
  const seen = new Set();
  return values.map((value) => String(value || "").trim().slice(0, 50)).filter((value) => {
    const key = value.toLocaleLowerCase("pt-BR");
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const emptyInputs = () => ({
  investment: "",
  investmentDate: today(),
  rate: "",
  periods: "",
  flows: [],
});

const emptyFinanceState = () => ({
  system: "PRICE",
  form: { description: "", principal: "", rate: "", periods: "", startDate: today() },
});

const emptyPricingState = () => ({
  productName: "",
  sku: "",
  expenses: [{ name: "", amount: "" }],
  units: "",
  margin: "",
});

const emptyInvoiceIssuer = () => ({
  legalName: "",
  document: "",
  stateRegistration: "",
  address: "",
  city: "",
  state: "",
});

function normalizeWorkspacePayload(payload = {}) {
  // Aplica valores seguros para rascunhos antigos ou parcialmente preenchidos.
  const defaults = {
    inputs: emptyInputs(),
    calculationType: "VPL",
    cashEntries: [blankCashRow()],
    cashFilters: { month: "", type: "todos", category: "todos" },
    financialCategories: DEFAULT_FINANCIAL_CATEGORIES,
    financialCategoryRules: [],
    organizationName: "Minha organização",
    saveTitle: "Simulação financeira",
    financeState: emptyFinanceState(),
    pricingState: emptyPricingState(),
    financialAccounts: [emptyFinancialAccount()],
    inventoryState: emptyInventoryState(),
    commerceOrders: [emptyCommerceOrder()],
    activeDocumentId: null,
    savedFinancings: [],
    invoiceIssuer: emptyInvoiceIssuer(),
    clients: [],
    tasks: [],
  };
  return {
    ...defaults,
    ...payload,
    // Registros antigos podiam deixar a aba ROI ativa; o ROI continua nos indicadores.
    calculationType: payload.calculationType === "ROI" ? "VPL" : payload.calculationType || "VPL",
    inputs: {
      ...defaults.inputs,
      ...(payload.inputs || {}),
      flows: (payload.inputs?.flows || []).map(normalizeProjectionFlow),
    },
    cashEntries:
      Array.isArray(payload.cashEntries) && payload.cashEntries.length
        ? payload.cashEntries
        : defaults.cashEntries,
    cashFilters: { ...defaults.cashFilters, ...(payload.cashFilters || {}) },
    financialCategories: normalizeFinancialCategories(payload),
    financialCategoryRules: normalizeCategoryRules(payload.financialCategoryRules),
    financeState: {
      ...defaults.financeState,
      ...(payload.financeState || {}),
      form: {
        ...defaults.financeState.form,
        ...(payload.financeState?.form || {}),
      },
    },
    pricingState: {
      ...defaults.pricingState,
      ...(payload.pricingState || {}),
      expenses:
        Array.isArray(payload.pricingState?.expenses) && payload.pricingState.expenses.length
          ? payload.pricingState.expenses
          : defaults.pricingState.expenses,
    },
    financialAccounts: Array.isArray(payload.financialAccounts)
      ? payload.financialAccounts
      : defaults.financialAccounts,
    inventoryState: {
      products: Array.isArray(payload.inventoryState?.products)
        ? payload.inventoryState.products.map((product) => ({
            ...product,
            // Produtos de versões anteriores já eram estoque real; entram bloqueados na nova regra.
            lockedAt: product.lockedAt || ((product.name || product.sku) && product.quantity !== "" ? "legacy" : ""),
          }))
        : defaults.inventoryState.products,
      deliveries: Array.isArray(payload.inventoryState?.deliveries)
        ? payload.inventoryState.deliveries
        : defaults.inventoryState.deliveries,
      orders: Array.isArray(payload.inventoryState?.orders)
        ? payload.inventoryState.orders
        : [],
    },
    commerceOrders: Array.isArray(payload.commerceOrders)
      ? payload.commerceOrders.map(({ document: _unneededDocument, ...order }) => order)
      : defaults.commerceOrders,
    activeDocumentId: /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(payload.activeDocumentId || ""))
      ? String(payload.activeDocumentId)
      : null,
    savedFinancings: Array.isArray(payload.savedFinancings)
      ? payload.savedFinancings
      : defaults.savedFinancings,
    invoiceIssuer: { ...defaults.invoiceIssuer, ...(payload.invoiceIssuer || {}) },
    clients: Array.isArray(payload.clients) ? payload.clients : defaults.clients,
    tasks: Array.isArray(payload.tasks) ? payload.tasks : defaults.tasks,
  };
}

function StatCard({ label, value, positive = true, neutral = false, caption }) {
  return (
    <article className="stat-card">
      <span>{label}</span>
      <strong className={neutral ? "" : positive ? "positive" : "negative"}>{value}</strong>
      <small>{caption}</small>
    </article>
  );
}

function CashFlowChart({ rows }) {
  const maxValue = Math.max(...rows.map((row) => Math.abs(row.flow)), 1);
  const chartWidth = Math.max(600, rows.length * 126);

  return (
    <div className="fc-chart-scroll" aria-label="Gráfico do fluxo de caixa">
      <div className="fc-chart" style={{ width: `${chartWidth}px` }}>
        {rows.map((row, index) => {
          // A altura é proporcional ao maior fluxo; o sinal define acima ou abaixo do eixo.
          const height =
            row.flow === 0
              ? 0
              : Math.max(8, (Math.abs(row.flow) / maxValue) * 68);
          const isIncome = row.flow >= 0;
          const movement =
            row.period === 0 && !isIncome
              ? "Aplicado"
              : isIncome
                ? "Entrada"
                : "Saída";
          // Exibe o sinal de forma explícita para que entradas e saídas
          // possam ser identificadas sem depender apenas da cor do gráfico.
          const signedValue = `${isIncome ? "+" : "-"}${money.format(Math.abs(row.flow))}`;
          const tooltipLabel = `${movement}: ${signedValue}, em ${formatDate(row.date)}`;
          return (
            <div
              className="fc-column"
              key={`${row.period}-${row.date}`}
              tabIndex="0"
              aria-label={tooltipLabel}
            >
              <div className="fc-track">
                {/* O valor vem primeiro e a data abaixo para facilitar a leitura. */}
                <span className="fc-tooltip" aria-hidden="true">
                  <strong>{signedValue}</strong>
                  <small>{formatDate(row.date)}</small>
                </span>
                <i
                  className={isIncome ? "fc-bar income" : "fc-bar expense"}
                  style={{ height: `${height}px`, "--bar-delay": `${Math.min(index * 35, 280)}ms` }}
                />
              </div>
              <strong className={isIncome ? "positive" : "negative"}>
                {movement}: {signedValue}
              </strong>
              <small>{formatDate(row.date)}</small>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CashBalanceChart({ rows }) {
  const movements = rows.filter((entry) => Number(entry.amount) > 0);
  if (!movements.length) {
    return <p className="empty-chart">Adicione movimentações com valor para acompanhar a evolução do caixa.</p>;
  }

  const balances = movements.map((entry) => Number(entry.runningBalance) || 0);
  const highest = Math.max(0, ...balances);
  const lowest = Math.min(0, ...balances);
  const finalBalance = balances.at(-1) || 0;
  const width = 760;
  const height = 230;
  const paddingX = 34;
  const paddingY = 28;
  const usableWidth = width - paddingX * 2;
  const usableHeight = height - paddingY * 2;
  const range = Math.max(highest - lowest, 1);
  const pointFor = (balance, index) => ({
    x: movements.length === 1 ? width / 2 : paddingX + (index / (movements.length - 1)) * usableWidth,
    y: paddingY + ((highest - balance) / range) * usableHeight,
  });
  const points = balances.map(pointFor);
  const zeroY = paddingY + ((highest - 0) / range) * usableHeight;
  const linePoints = points.map(({ x, y }) => `${x},${y}`).join(" ");
  const areaPoints = `${paddingX},${zeroY} ${linePoints} ${points.at(-1).x},${zeroY}`;
  const description = `Saldo acumulado iniciado em zero no período filtrado, encerrando em ${money.format(finalBalance)}.`;

  return (
    <article className="cash-balance-card panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">FLUXO DE CAIXA</span>
          <h2>Evolução do saldo acumulado</h2>
          <p>Mostra como cada entrada ou saída altera o caixa dentro do período filtrado.</p>
        </div>
        <span className={finalBalance >= 0 ? "cash-balance-status positive" : "cash-balance-status negative"}>
          {finalBalance >= 0 ? "Caixa positivo" : "Caixa negativo"}
        </span>
      </div>
      <div className="cash-balance-summary" aria-label="Resumo do fluxo de caixa">
        <span><small>Maior saldo</small><strong className="positive">{money.format(highest)}</strong></span>
        <span><small>Menor saldo</small><strong className={lowest < 0 ? "negative" : ""}>{money.format(lowest)}</strong></span>
        <span><small>Saldo final</small><strong className={finalBalance >= 0 ? "positive" : "negative"}>{money.format(finalBalance)}</strong></span>
      </div>
      <div className="cash-balance-chart">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="cash-balance-title cash-balance-description">
          <title id="cash-balance-title">Gráfico do saldo acumulado</title>
          <desc id="cash-balance-description">{description}</desc>
          <line className="cash-zero-line" x1={paddingX} x2={width - paddingX} y1={zeroY} y2={zeroY} />
          <polygon className={finalBalance >= 0 ? "cash-balance-area positive-area" : "cash-balance-area negative-area"} points={areaPoints} />
          <polyline className="cash-balance-line" points={linePoints} pathLength="1" />
          {points.map((point, index) => (
            <circle
              className={balances[index] >= 0 ? "cash-balance-point positive-point" : "cash-balance-point negative-point"}
              key={`${movements[index].date}-${index}`}
              cx={point.x}
              cy={point.y}
              r="5"
            >
              <title>{`${formatDate(movements[index].date)}: ${money.format(balances[index])}`}</title>
            </circle>
          ))}
        </svg>
      </div>
      <p className="cash-balance-note">O cálculo começa em R$ 0 no período selecionado. A tabela abaixo continua sendo a fonte detalhada para conferência.</p>
    </article>
  );
}

function InvitationDetails({ invitation }) {
  if (!invitation) return null;
  return (
    <div className="invite-company-card">
      <div><span>Empresa</span><strong>{invitation.organizationName}</strong></div>
      <div><span>Cargo</span><strong>{invitation.jobTitle}</strong></div>
      <div><span>E-mail convidado</span><strong>{invitation.maskedEmail}</strong></div>
      <div className="invite-permission-summary">
        <span>Áreas liberadas</span>
        <p>{invitation.permissionLabels.length ? invitation.permissionLabels.join(" · ") : "Acesso básico"}</p>
      </div>
    </div>
  );
}

function EmailVerificationScreen({ user, onVerified, onLogout }) {
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("Enviamos um link de confirmação. Confira também sua caixa de spam.");
  async function resend() {
    setStatus("loading");
    try {
      const response = await fetch("/api/auth/resend-verification", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível reenviar.");
      setMessage(body.message); setStatus("success");
    } catch (error) { setMessage(error.message); setStatus("error"); }
  }
  async function check() {
    setStatus("loading");
    try {
      const refreshed = await hydrateAuthenticatedUser();
      if (!refreshed?.emailVerified) throw new Error("O e-mail ainda não foi confirmado. Abra o link recebido e tente novamente.");
      await onVerified(refreshed);
    } catch (error) { setMessage(error.message); setStatus("error"); }
  }
  return <main className="auth-layout"><section className="auth-aside"><div className="brand"><img className="brand-mark" src="/candtech-mark.svg" alt="" /> CandTech</div><div className="auth-message"><span className="auth-badge">PROTEÇÃO DA CONTA</span><h1>Confirme que este e-mail pertence a você.</h1></div><p>Essa etapa impede que outra pessoa cadastre seu endereço e protege o acesso aos dados da empresa.</p></section><section className="auth-card"><p className="eyebrow">CONFIRMAÇÃO DE E-MAIL</p><h2>Abra o link que enviamos</h2><p className="auth-subtitle">Enviado para <strong>{user.email}</strong>. O link funciona uma vez e expira em 24 horas.</p><p className={status === "error" ? "form-error" : "password-hint"}>{message}</p><button type="button" className="primary-button" disabled={status === "loading"} onClick={check}>{status === "loading" ? "Conferindo…" : "Já confirmei meu e-mail"}</button><button type="button" className="text-button" disabled={status === "loading"} onClick={resend}>Reenviar e-mail</button><button type="button" className="text-button" disabled={status === "loading"} onClick={onLogout}>Usar outra conta</button></section></main>;
}

function LegalLicenseModal({ onClose }) {
  useEffect(() => {
    const closeOnEscape = (event) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return <div className="legal-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="legal-modal" role="dialog" aria-modal="true" aria-labelledby="legal-license-title">
      <header><div><span className="eyebrow">LICENÇA DE USO</span><h2 id="legal-license-title">Antes de criar sua conta</h2></div><button type="button" className="legal-modal-close" aria-label="Fechar termo" onClick={onClose}>×</button></header>
      <div className="legal-modal-content">
        <p>A CandTech concede uma licença limitada, pessoal ou empresarial, revogável e não transferível para uso do ERP conforme os Termos de Uso.</p>
        <ul>
          <li><strong>Conta e empresa:</strong> você deve informar dados verdadeiros e proteger sua senha. Quem cadastra uma empresa declara ter autorização para representá-la.</li>
          <li><strong>Assinatura:</strong> quando a cobrança estiver habilitada, o uso das áreas operacionais dependerá de pagamento Pix confirmado manualmente pelo administrador. Gerar ou copiar o código não libera acesso.</li>
          <li><strong>Dados e resultados:</strong> os dados inseridos continuam sob controle da conta. Relatórios auxiliam a gestão, mas não substituem contabilidade, assessoria jurídica ou documentos fiscais oficiais.</li>
          <li><strong>Uso permitido:</strong> é proibido invadir, contornar permissões, enviar código malicioso ou usar o serviço para atividade ilegal.</li>
          <li><strong>Privacidade:</strong> tratamos apenas os dados necessários para autenticação, operação, segurança, suporte e cobrança, conforme o Aviso de Privacidade.</li>
        </ul>
        <p>Seu aceite fica registrado com data e versão. Direitos obrigatórios previstos no CDC e na LGPD não são afastados por este resumo.</p>
        <div className="legal-modal-links"><a href="/termos" target="_blank" rel="noreferrer">Termos completos</a><a href="/propriedade-intelectual" target="_blank" rel="noreferrer">Marca e imagens</a><a href="/privacidade" target="_blank" rel="noreferrer">Aviso de Privacidade</a><a href="/cancelamento" target="_blank" rel="noreferrer">Cobrança e cancelamento</a></div>
      </div>
      <footer><button type="button" className="primary-button" onClick={onClose}>Fechar e voltar ao aceite</button></footer>
    </section>
  </div>;
}

function PaymentRequiredScreen({ user, onLogout }) {
  const owner = user?.isBillingOwner !== false;
  return <main className="auth-layout"><section className="auth-aside"><div className="brand"><img className="brand-mark" src="/candtech-mark.svg" alt="" /> CandTech</div><div className="auth-message"><span className="auth-badge">ASSINATURA NECESSÁRIA</span><h1>O acesso ao ERP é liberado após a confirmação do Pix.</h1></div><p>O administrador confere o recebimento antes de ativar o plano; gerar o código sozinho não libera acesso.</p></section><section className="auth-card"><p className="eyebrow">ACESSO PROTEGIDO</p><h2>{owner ? "Regularize sua assinatura" : "A assinatura da empresa está inativa"}</h2><p className="auth-subtitle">{owner ? "Gere o Pix, pague pelo aplicativo do seu banco e avise pelo site ou WhatsApp." : "Peça ao proprietário da empresa para regularizar a assinatura. Seu cargo e suas permissões serão mantidos."}</p>{owner && <a className="primary-button payment-required-link" href="/assinar">Ir para pagamento Pix</a>}<button type="button" className="text-button" onClick={onLogout}>Sair desta conta</button></section></main>;
}

function AdministrativeAccessScreen({ user, onLogout }) {
  // Colaboradores internos não precisam comprar o ERP para trabalhar, mas uma
  // permissão administrativa também não libera os módulos financeiros pagos.
  return <main className="auth-layout"><section className="auth-aside"><div className="brand"><img className="brand-mark" src="/candtech-mark.svg" alt="" /> CandTech</div><div className="auth-message"><span className="auth-badge">ACESSO INTERNO</span><h1>Sua conta está pronta para a central operacional.</h1></div><p>Você verá somente suporte, cobrança ou monitoramento conforme as permissões concedidas pelo administrador principal.</p></section><section className="auth-card"><p className="eyebrow">EQUIPE CANDTECH</p><h2>Olá, {user.name}</h2><p className="auth-subtitle">O ERP financeiro continua protegido pela assinatura. Seu login interno dá acesso apenas às tarefas administrativas autorizadas.</p><a className="primary-button payment-required-link" href={user.monitoringPath} rel="nofollow">Abrir central privada</a><button type="button" className="text-button" onClick={onLogout}>Sair desta conta</button></section></main>;
}

function LegalAcceptanceScreen({ onAccepted, onLogout }) {
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    if (!checked) return;
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/legal/accept", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accepted: true }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível registrar o aceite.");
      const refreshed = await hydrateAuthenticatedUser();
      if (!refreshed?.legalAccepted) throw new Error("O aceite não pôde ser confirmado.");
      onAccepted(refreshed);
    } catch (acceptError) { setError(acceptError.message); setLoading(false); }
  }
  return <main className="auth-layout"><section className="auth-aside"><div className="brand"><img className="brand-mark" src="/candtech-mark.svg" alt="" /> CandTech</div><div className="auth-message"><span className="auth-badge">ATUALIZAÇÃO JURÍDICA</span><h1>Regras claras para proteger sua empresa e seus dados.</h1></div><p>Registramos a versão aceita para que qualquer alteração relevante seja transparente.</p></section><section className="auth-card"><p className="eyebrow">ACEITE NECESSÁRIO</p><h2>Revise os documentos atuais</h2><p className="auth-subtitle">O acesso continua depois de um aceite expresso. Direitos obrigatórios previstos em lei permanecem preservados.</p><form onSubmit={submit}><label className="legal-acceptance"><input type="checkbox" required checked={checked} onChange={(event) => setChecked(event.target.checked)} /><span>Li e aceito os <a href="/termos" target="_blank" rel="noreferrer">Termos de Uso</a> e o <a href="/privacidade" target="_blank" rel="noreferrer">Aviso de Privacidade</a>.</span></label>{error && <p className="form-error">{error}</p>}<button className="primary-button" disabled={loading || !checked}>{loading ? "Registrando…" : "Aceitar e continuar"}</button></form><button type="button" className="text-button" disabled={loading} onClick={onLogout}>Sair sem aceitar</button></section></main>;
}

function MfaEnrollmentScreen({ user, onCompleted, onLogout }) {
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function begin(event) {
    event.preventDefault(); setLoading(true); setError("");
    try {
      const response = await fetch("/api/auth/mfa/setup", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: password }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível gerar o QR Code.");
      setPassword(""); setSetup(body);
    } catch (setupError) { setError(setupError.message); }
    finally { setLoading(false); }
  }

  async function confirm(event) {
    event.preventDefault(); setLoading(true); setError("");
    try {
      const response = await fetch("/api/auth/mfa/setup", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível ativar o MFA.");
      setRecoveryCodes(body.recoveryCodes || []);
    } catch (confirmationError) { setError(confirmationError.message); }
    finally { setLoading(false); }
  }

  if (user.mfaEnabled && !user.mfaVerified) {
    return <main className="auth-layout"><section className="auth-aside"><div className="brand"><img className="brand-mark" src="/candtech-mark.svg" alt="" /> CandTech</div><div className="auth-message"><span className="auth-badge">SEGUNDO FATOR</span><h1>Confirme o autenticador para continuar.</h1></div><p>Esta sessão foi criada antes da verificação MFA e precisa ser autenticada novamente.</p></section><section className="auth-card"><p className="eyebrow">SESSÃO PROTEGIDA</p><h2>Entre novamente</h2><p className="auth-subtitle">Sua configuração está ativa. Saia e informe o código de seis dígitos depois da senha.</p><button className="primary-button" type="button" onClick={onLogout}>Sair e confirmar MFA</button></section></main>;
  }

  return <main className="auth-layout"><section className="auth-aside"><div className="brand"><img className="brand-mark" src="/candtech-mark.svg" alt="" /> CandTech</div><div className="auth-message"><span className="auth-badge">PROTEÇÃO OBRIGATÓRIA</span><h1>Adicione uma segunda etapa ao seu acesso.</h1></div><p>Proprietários e equipe administrativa usam um aplicativo autenticador para reduzir o risco de invasão por senha roubada.</p></section><section className="auth-card"><p className="eyebrow">AUTENTICAÇÃO EM DUAS ETAPAS</p><h2>{recoveryCodes.length ? "Guarde seus códigos" : setup ? "Leia o QR Code" : "Proteja sua conta"}</h2>
    {recoveryCodes.length ? <><p className="auth-subtitle">Cada código funciona uma única vez. Guarde-os fora deste computador; eles não serão mostrados novamente.</p><div className="mfa-recovery-list">{recoveryCodes.map((item) => <code key={item}>{item}</code>)}</div><button className="primary-button" type="button" onClick={onCompleted}>Já guardei, continuar</button></>
      : setup ? <form onSubmit={confirm}><p className="auth-subtitle">No Google Authenticator, Microsoft Authenticator, 1Password ou similar, leia o QR e informe o código exibido.</p><img className="mfa-qr" src={setup.qrCode} alt="QR Code para configurar o autenticador" /><details><summary>Não consegue ler o QR?</summary><code className="mfa-secret">{setup.secret}</code></details><label>Código de 6 dígitos<input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength="6" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" disabled={loading}>{loading ? "Confirmando…" : "Ativar MFA"}</button></form>
      : <form onSubmit={begin}><p className="auth-subtitle">Confirme primeiro a senha atual. A CandTech gerará um segredo exclusivo e cifrado.</p><label>Senha atual<input required type="password" autoComplete="current-password" minLength="8" maxLength="128" value={password} onChange={(event) => setPassword(event.target.value)} /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" disabled={loading}>{loading ? "Gerando…" : "Gerar QR Code seguro"}</button></form>}
    {!recoveryCodes.length && <button type="button" className="text-button" disabled={loading} onClick={onLogout}>Sair desta conta</button>}
  </section></main>;
}

function AuthScreen({ onAuthenticated, inviteToken, authenticatedUser = null, onSwitchAccount }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "", accountType: "person", legalAccepted: false });
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [invitePreview, setInvitePreview] = useState(null);
  const [inviteLoading, setInviteLoading] = useState(Boolean(inviteToken));
  const [inviteError, setInviteError] = useState("");
  const [showLicense, setShowLicense] = useState(false);
  const [mfaChallenge, setMfaChallenge] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const emailInputRef = useRef(null);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("cadastro") === "1") setMode("register");
    if (!inviteToken) return;
    setMode("register");
    setForm((current) => ({ ...current, accountType: "person" }));
    let active = true;
    fetch("/api/team/invitation/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: inviteToken }),
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Não foi possível consultar o convite.");
        if (active) setInvitePreview(body.invitation);
      })
      .catch((previewError) => {
        if (active) setInviteError(previewError.message);
      })
      .finally(() => {
        if (active) setInviteLoading(false);
      });
    return () => { active = false; };
  }, [inviteToken]);
  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setErrorCode("");
    try {
      const verifyingMfa = Boolean(mfaChallenge);
      const response = await fetch(
        verifyingMfa ? "/api/auth/mfa/verify" : `/api/auth/${mode === "login" ? "login" : "register"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(verifyingMfa ? { challenge: mfaChallenge, code: mfaCode } : form),
        },
      );
      const data = await response.json();
      if (!response.ok) {
        setErrorCode(data.code || "");
        if (data.code === "EMAIL_ALREADY_REGISTERED") {
          requestAnimationFrame(() => emailInputRef.current?.focus());
        }
        throw new Error(data.error || "Não foi possível continuar.");
      }
      if (data.mfaRequired) {
        setMfaChallenge(data.challenge);
        setMfaCode("");
        setForm((current) => ({ ...current, password: "" }));
        return;
      }
      trackMarketingEvent(mode === "login" ? "login" : "sign_up", {
        method: "email",
        account_type: data.user?.accountType || form.accountType,
      });
      await onAuthenticated(data.user);
    } catch (submitError) {
      setError(submitError.message || "Não foi possível continuar.");
    } finally {
      setLoading(false);
    }
  }
  async function confirmAuthenticatedAccount() {
    setLoading(true);
    setError("");
    try {
      await onAuthenticated(authenticatedUser);
    } catch (confirmationError) {
      setError(confirmationError.message || "Não foi possível aceitar o convite.");
    } finally {
      setLoading(false);
    }
  }
  const isInvitation = Boolean(inviteToken);
  if (mfaChallenge) return <main className="auth-layout"><section className="auth-aside"><div className="brand"><img className="brand-mark" src="/candtech-mark.svg" alt="" /> CandTech</div><div className="auth-message"><span className="auth-badge">SEGUNDO FATOR</span><h1>Uma etapa curta para proteger sua conta.</h1></div><p>Abra o aplicativo autenticador ou use um dos códigos de recuperação guardados na ativação.</p></section><section className="auth-card"><p className="eyebrow">VERIFICAÇÃO MFA</p><h2>Informe o código</h2><p className="auth-subtitle">O código de seis dígitos muda a cada 30 segundos. Um código de recuperação também é aceito.</p><form onSubmit={submit}><label>Código do autenticador<input autoFocus required autoComplete="one-time-code" value={mfaCode} maxLength="24" onChange={(event) => setMfaCode(event.target.value)} /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" disabled={loading}>{loading ? "Verificando…" : "Confirmar e entrar"}</button></form><button type="button" className="text-button" onClick={() => { setMfaChallenge(""); setMfaCode(""); setError(""); }}>Voltar para e-mail e senha</button></section></main>;
  return (
    <main className="auth-layout">
      <section className="auth-aside">
        <div className="brand">
          <img className="brand-mark" src="/candtech-mark.svg" alt="" /> CandTech
        </div>
        <div className="auth-message">
          <span className="auth-badge">{isInvitation ? "CONVITE DE ACESSO" : "FINANÇAS CLARAS, DECISÕES MELHORES"}</span>
          <h1>{isInvitation ? `Você foi convidado para ${invitePreview?.organizationName || "uma empresa"}.` : "Seu espaço financeiro, organizado do seu jeito."}</h1>
        </div>
        <p>
          {isInvitation
            ? "Confira o cargo e as áreas liberadas. O vínculo só será criado depois que seu e-mail for autenticado."
            : "Crie análises, acompanhe números e encontre seus documentos sempre que precisar — tudo em uma única conta."}
        </p>
        <div className="auth-points">
          {isInvitation ? <>
            <span><i>01</i><b>Empresa identificada</b><small>{invitePreview?.organizationName || "Consultando o convite..."}</small></span>
            <span><i>02</i><b>Cargo definido</b><small>{invitePreview?.jobTitle || "Aguardando validação"}</small></span>
            <span><i>03</i><b>Acesso limitado</b><small>Você verá somente as áreas permitidas pelo cargo.</small></span>
          </> : <>
            <span><i>01</i><b>Documentos organizados</b><small>Histórico privado e salvamento automático.</small></span>
            <span><i>02</i><b>Análises confiáveis</b><small>Cálculos auditados e memória detalhada.</small></span>
            <span><i>03</i><b>Exporte como preferir</b><small>Excel, CSV, PDF ou Google Drive.</small></span>
          </>}
        </div>
        <small className="auth-footnote">{isInvitation ? "O convite não concede acesso antes da autenticação." : "Seus dados pertencem à sua conta."}</small>
      </section>
      <section className="auth-card">
        <div className="auth-product-visual" aria-hidden="true">
          <div className="product-visual-top"><span /><span /><span /><b>CandTech workspace</b></div>
          <div className="product-visual-body">
            <div className="product-visual-nav"><i /><i /><i /><i /></div>
            <div className="product-visual-content">
              <div className="product-visual-heading"><b /><span /></div>
              <div className="product-visual-stats"><i /><i /><i /></div>
              <div className="product-visual-chart">
                <span style={{ height: "38%" }} /><span style={{ height: "68%" }} />
                <span style={{ height: "49%" }} /><span style={{ height: "84%" }} />
                <span style={{ height: "61%" }} /><span style={{ height: "94%" }} />
              </div>
            </div>
          </div>
        </div>
        <div className="auth-mobile-brand brand"><img className="brand-mark" src="/candtech-mark.svg" alt="" /> CandTech</div>
        <p className="eyebrow">{isInvitation ? "INGRESSAR NA EMPRESA" : mode === "login" ? "BEM-VINDO DE VOLTA" : "COMECE AGORA"}</p>
        <h2>{isInvitation ? (authenticatedUser ? "Confirme sua conta" : mode === "login" ? "Entre com sua conta" : "Crie seu acesso") : mode === "login" ? "Entre no seu espaço" : "Crie seu espaço financeiro"}</h2>
        <p className="auth-subtitle">
          {isInvitation
            ? authenticatedUser
              ? "Confirme que deseja entrar na empresa com a conta conectada abaixo."
              : mode === "login"
                ? "Use a conta que possui o mesmo e-mail do convite."
                : "Defina seu nome e uma senha para acessar a empresa."
            : mode === "login"
            ? "Continue de onde parou e acesse seus documentos."
            : "Organize suas decisões financeiras em poucos minutos."}
        </p>
        {inviteLoading && <div className="invite-auth-banner"><strong>Consultando convite…</strong><span>Estamos validando a empresa e o cargo antes de pedir seus dados.</span></div>}
        {inviteError && <div className="invite-auth-banner error"><strong>Não foi possível abrir o convite</strong><span>{inviteError}</span><a href="/">Voltar para a CandTech</a></div>}
        {invitePreview && <InvitationDetails invitation={invitePreview} />}
        {authenticatedUser && invitePreview && !inviteError ? (
          <div className="invite-confirm-account">
            <span>Conta conectada</span>
            <strong>{authenticatedUser.name}</strong>
            <small>{authenticatedUser.email}</small>
            {error && <p className="form-error">{error}</p>}
            <button type="button" className="primary-button" disabled={loading} onClick={confirmAuthenticatedAccount}>{loading ? "Ingressando…" : `Entrar em ${invitePreview.organizationName}`}</button>
            <button type="button" className="text-button" disabled={loading} onClick={onSwitchAccount}>Usar outra conta</button>
          </div>
        ) : !inviteLoading && !inviteError && (
        <form onSubmit={submit}>
          {mode === "register" && (
            <>
              {!inviteToken && <div className="account-type-field">
                <span>Como você vai usar?</span>
                <div className="account-type-toggle" role="group" aria-label="Tipo de cadastro">
                  <button type="button" className={form.accountType === "person" ? "active" : ""} onClick={() => setForm({ ...form, accountType: "person" })}>Pessoa física</button>
                  <button type="button" className={form.accountType === "company" ? "active" : ""} onClick={() => setForm({ ...form, accountType: "company" })}>Empresa</button>
                </div>
              </div>}
              <label>
                {form.accountType === "person" ? "Nome completo" : "Responsável pela empresa"}
                <input
                  required
                  minLength="2"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
            </>
          )}
          <label>
            {isInvitation ? "E-mail que recebeu o convite" : "E-mail"}
            <input
              ref={emailInputRef}
              required
              type="email"
              autoComplete="email"
              aria-invalid={errorCode === "EMAIL_ALREADY_REGISTERED" ? "true" : undefined}
              aria-describedby={errorCode === "EMAIL_ALREADY_REGISTERED" ? "registered-email-error" : undefined}
              value={form.email}
              onChange={(e) => {
                setForm({ ...form, email: e.target.value });
                if (errorCode === "EMAIL_ALREADY_REGISTERED") {
                  setError("");
                  setErrorCode("");
                }
              }}
            />
            {errorCode === "EMAIL_ALREADY_REGISTERED" && (
              <span id="registered-email-error" className="email-exists-alert" role="alert">
                <strong>Esta conta já foi criada.</strong>
                <span>Entre com esse e-mail ou recupere a senha para continuar.</span>
                <span className="email-exists-actions">
                  <button type="button" onClick={() => { setMode("login"); setError(""); setErrorCode(""); }}>Entrar na conta</button>
                  <a href="/esqueci-senha">Recuperar senha</a>
                </span>
              </span>
            )}
          </label>
          <label>
            Senha
            <input
              required
              type="password"
              minLength="8"
              maxLength="128"
              placeholder={
                mode === "register" ? "Ao menos 8 caracteres" : "Sua senha"
              }
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            {mode === "register" && (
              <small className="password-hint">
                Mínimo 8. Para maior segurança, prefira uma frase com 15 ou mais caracteres.
              </small>
            )}
          </label>
          {mode === "register" && (
            <div className="legal-register-box">
              <button type="button" className="legal-review-button" onClick={() => setShowLicense(true)}>Ler licença de uso em tela</button>
              <label className="legal-acceptance">
                <input type="checkbox" required checked={form.legalAccepted} onChange={(e) => setForm({ ...form, legalAccepted: e.target.checked })} />
                <span>Li e aceito os <a href="/termos" target="_blank" rel="noreferrer">Termos de Uso</a> e o <a href="/privacidade" target="_blank" rel="noreferrer">Aviso de Privacidade</a>.</span>
              </label>
            </div>
          )}
          {mode === "login" && !isInvitation && (
            <a className="text-button" href="/esqueci-senha">Esqueci minha senha</a>
          )}
          {error && errorCode !== "EMAIL_ALREADY_REGISTERED" && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" disabled={loading}>
            {loading
              ? isInvitation ? "Validando e ingressando…" : "Aguarde..."
              : mode === "login"
                ? isInvitation ? "Entrar e aceitar convite" : "Entrar"
                : isInvitation ? "Criar acesso e entrar" : "Criar conta"}
          </button>
        </form>
        )}
        {!authenticatedUser && !inviteLoading && !inviteError && (mode === "login" ? (
          inviteToken
            ? <button className="text-button" onClick={() => { setMode("register"); setError(""); }}>Ainda não tenho conta</button>
            : <div className="auth-subscribe-link"><span>Não é assinante?</span><a href="/assinar">Assine agora</a></div>
        ) : (
          <button className="text-button" onClick={() => { setMode("login"); setError(""); }}>Já possui conta? Entrar</button>
        ))}
      </section>
      {showLicense && <LegalLicenseModal onClose={() => setShowLicense(false)} />}
    </main>
  );
}

export default function CandTechApp({ publicFallback = null }) {
  const { requestFileName, fileNameDialogProps } = useFileNameDialog();
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [authRequested, setAuthRequested] = useState(false);
  const [saveStatus, setSaveStatus] = useState("loading");
  const [view, setView] = useState("home");
  const [calculationType, setCalculationType] = useState("VPL");
  // Os campos começam vazios; as linhas do fluxo serão criadas pela quantidade de períodos.
  const [inputs, setInputs] = useState(emptyInputs);
  const [cashEntries, setCashEntries] = useState([blankCashRow()]);
  const [cashFilters, setCashFilters] = useState({
    month: "",
    type: "todos",
    category: "todos",
  });
  const [financialCategories, setFinancialCategories] = useState(DEFAULT_FINANCIAL_CATEGORIES);
  const [financialCategoryRules, setFinancialCategoryRules] = useState([]);
  const [organizationName, setOrganizationName] = useState("Minha organização");
  const [history, setHistory] = useState([]);
  const [historyNextCursor, setHistoryNextCursor] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [driveStatus, setDriveStatus] = useState({
    configured: false,
    connected: false,
    loading: true,
  });
  const [driveUpload, setDriveUpload] = useState({ id: null, status: "idle", file: null });
  const [fileDownload, setFileDownload] = useState({ id: null, format: null });
  const [currentPdfLoading, setCurrentPdfLoading] = useState(false);
  const [saveTitle, setSaveTitle] = useState("Simulação financeira");
  const [financeState, setFinanceState] = useState(emptyFinanceState);
  const [pricingState, setPricingState] = useState(emptyPricingState);
  const [financialAccounts, setFinancialAccounts] = useState([emptyFinancialAccount()]);
  const [inventoryState, setInventoryState] = useState(emptyInventoryState);
  const [commerceOrders, setCommerceOrders] = useState([emptyCommerceOrder()]);
  const [activeDocumentId, setActiveDocumentId] = useState(null);
  const [savedFinancings, setSavedFinancings] = useState([]);
  const [invoiceIssuer, setInvoiceIssuer] = useState(emptyInvoiceIssuer);
  const [clients, setClients] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [adminOverview, setAdminOverview] = useState(null);
  const [isAdministrator, setIsAdministrator] = useState(false);
  const [showExportCenter, setShowExportCenter] = useState(false);
  const [inviteToken] = useState(invitationTokenFromLocation);
  const [inviteComplete, setInviteComplete] = useState(() => !inviteToken);
  const [exportSections, setExportSections] = useState({ calculations: true, finance: true, inventory: true, commerce: true });
  const lastSavedWorkspace = useRef("");
  const autoSaveTimer = useRef(null);
  const sidebarNavRef = useRef(null);
  const result = useMemo(() => calculateInvestment(inputs), [inputs]);
  const financialTableResult = useMemo(
    () => calculateAmortization({ ...financeState.form, system: financeState.system }),
    [financeState],
  );
  const pricingResult = useMemo(
    () => calculateProductPrice(pricingState),
    [pricingState],
  );
  const workspacePayload = useMemo(
    () => ({
      inputs,
      calculationType,
      cashEntries,
      cashFilters,
      financialCategories,
      financialCategoryRules,
      organizationName,
      saveTitle,
      financeState,
      pricingState,
      financialAccounts,
      inventoryState,
      commerceOrders,
      activeDocumentId,
      savedFinancings,
      invoiceIssuer,
      clients,
      tasks,
    }),
    [
      inputs,
      calculationType,
      cashEntries,
      cashFilters,
      financialCategories,
      financialCategoryRules,
      organizationName,
      saveTitle,
      financeState,
      pricingState,
      financialAccounts,
      inventoryState,
      commerceOrders,
      activeDocumentId,
      savedFinancings,
      invoiceIssuer,
      clients,
      tasks,
    ],
  );
  const canAccess = (permission) => {
    const access = user?.access;
    // Sem o contexto de acesso confirmado pelo servidor, a interface também
    // nega as áreas. As APIs repetem a mesma validação no lado seguro.
    return Boolean(access && (["owner", "personal"].includes(access.role) || access.permissions?.includes(permission)));
  };
  useEffect(() => {
    hydrateAuthenticatedUser()
      .then((authenticatedUser) => {
        if (authenticatedUser) setUser(authenticatedUser);
      })
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setAuthRequested(Boolean(inviteToken) || params.get("cadastro") === "1" || params.get("entrar") === "1");
  }, [inviteToken]);

  async function completeAuthentication(baseUser) {
    const hydratedUser = await hydrateAuthenticatedUser();
    if (hydratedUser && !hydratedUser.emailVerified) {
      setUser(hydratedUser);
      return;
    }
    let acceptedAccess = null;
    if (inviteToken) acceptedAccess = await acceptInvitation(inviteToken);
    // Depois do convite, consulta novamente o servidor para receber tanto as
    // permissões da empresa quanto o status de assinatura do proprietário.
    const refreshedAfterInvite = acceptedAccess ? await hydrateAuthenticatedUser() : null;
    const confirmedUser = refreshedAfterInvite || hydratedUser || (acceptedAccess && baseUser
      ? { ...baseUser, access: acceptedAccess }
      : null);
    if (!confirmedUser) throw new Error("Não foi possível confirmar sua sessão.");
    // Interrompe qualquer salvamento do workspace anterior antes de trocar a
    // organização que será resolvida pelas APIs.
    setWorkspaceReady(false);
    lastSavedWorkspace.current = "";
    setUser(confirmedUser);
    if (acceptedAccess) {
      setNotice(`Convite aceito. Você entrou em ${acceptedAccess.organizationName} como ${acceptedAccess.jobTitle || "colaborador"}.`);
      setInviteComplete(true);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }

  async function switchInvitationAccount() {
    try {
      await fetch("/api/auth/me", { method: "DELETE" });
    } finally {
      // Mesmo que a rede falhe, a interface deixa de reutilizar a identidade
      // anterior e permite informar novamente a conta que recebeu o convite.
      setUser(null);
      setWorkspaceReady(false);
      setNotice("");
    }
  }

  useEffect(() => {
    // O callback OAuth volta para a página inicial com um estado curto e sem tokens na URL.
    const params = new URLSearchParams(window.location.search);
    const driveResult = params.get("drive");
    if (!driveResult) return;
    const messages = {
      connected: "Google Drive conectado à sua conta.",
      denied: "A conexão com o Google Drive foi cancelada.",
      "session-error": "Sua sessão expirou durante a conexão com o Google.",
      "state-error": "A resposta do Google não passou na validação de segurança.",
      error: "Não foi possível concluir a conexão com o Google Drive.",
    };
    const pendingHistoryId = params.get("export");
    const pendingInventory = params.get("inventoryDrive") === "1";
    const pendingFilename = params.get("filename") || "";
    if (driveResult === "connected" && pendingInventory) {
      sessionStorage.setItem("candtech_pending_inventory_drive", pendingFilename || "estoque-candtech.xlsx");
      setView("inventory");
      setNotice(messages.connected);
    } else if (driveResult === "connected" && /^[0-9a-f-]{36}$/i.test(pendingHistoryId || "")) {
      // Continua automaticamente o envio iniciado antes da autorização do Google.
      sendHistoryToDrive({ id: pendingHistoryId }, pendingFilename);
    } else {
      setNotice(messages[driveResult] || "O Google Drive respondeu à solicitação.");
    }
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  useEffect(() => {
    if (!user || (user.subscriptionRequired && !user.subscriptionActive)) {
      setDriveStatus({ configured: false, connected: false, loading: false });
      return;
    }
    if (!canAccess("drive")) {
      setDriveStatus({ configured: false, connected: false, loading: false });
      return;
    }
    let active = true;
    fetch("/api/google-drive/status")
      .then((response) => (response.ok ? response.json() : null))
      .then((status) => {
        if (active && status) setDriveStatus({ ...status, loading: false });
      })
      .catch(() => {
        if (active) setDriveStatus({ configured: false, connected: false, loading: false });
      });
    return () => {
      active = false;
    };
  }, [user?.id, user?.access?.permissions?.join(","), user?.subscriptionRequired, user?.subscriptionActive]);

  async function loadAdminOverview() {
    const response = await fetch("/api/admin/overview");
    if (response.ok) {
      setIsAdministrator(true);
      setAdminOverview(await response.json());
    } else if ([401, 403, 404].includes(response.status)) {
      setIsAdministrator(false);
      setAdminOverview(null);
      if (view === "admin") setView("home");
    }
  }

  useEffect(() => {
    const administrator = Boolean(user?.administrator);
    setIsAdministrator(administrator);
    if (administrator) loadAdminOverview();
    else setAdminOverview(null);
  }, [user?.id, user?.administrator, user?.emailVerified, user?.access?.organizationId]);

  useEffect(() => {
    if (!user || (user.subscriptionRequired && !user.subscriptionActive)) {
      setWorkspaceReady(false);
      return;
    }

    let active = true;
    setWorkspaceReady(false);
    setSaveStatus("loading");
    fetch("/api/workspace")
      .then((response) => {
        if (!response.ok) throw new Error("Falha ao carregar workspace");
        return response.json();
      })
      .then(({ workspace }) => {
        if (!active) return;
        const restored = normalizeWorkspacePayload(workspace?.payload);
        applyWorkspace(restored);
        lastSavedWorkspace.current = JSON.stringify(restored);
        setSaveStatus("saved");
        if (workspace) setNotice("Seus dados desta conta foram restaurados automaticamente.");
      })
      .catch(() => {
        if (!active) return;
        const empty = normalizeWorkspacePayload();
        applyWorkspace(empty);
        lastSavedWorkspace.current = JSON.stringify(empty);
        setSaveStatus("error");
      })
      .finally(() => {
        if (active) setWorkspaceReady(true);
      });

    return () => {
      active = false;
    };
  }, [user?.id, user?.emailVerified, user?.access?.organizationId, user?.subscriptionRequired, user?.subscriptionActive]);

  useEffect(() => {
    if (!user || !workspaceReady) return;
    const serialized = JSON.stringify(workspacePayload);
    if (serialized === lastSavedWorkspace.current) return;

    setSaveStatus("saving");
    clearTimeout(autoSaveTimer.current);
    // O pequeno atraso agrupa várias teclas em uma única gravação no banco.
    autoSaveTimer.current = setTimeout(() => {
      persistWorkspace(workspacePayload).catch(() => setSaveStatus("error"));
    }, 900);
    return () => clearTimeout(autoSaveTimer.current);
  }, [user?.id, workspaceReady, workspacePayload]);

  useEffect(() => {
    if (!user || !workspaceReady) return;
    const archiveBeforeLeaving = () => {
      // keepalive permite concluir a requisição mesmo enquanto a aba está fechando.
      fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: workspacePayload }),
        keepalive: true,
      }).catch(() => {});
    };
    window.addEventListener("pagehide", archiveBeforeLeaving);
    return () => window.removeEventListener("pagehide", archiveBeforeLeaving);
  }, [user?.id, workspaceReady, workspacePayload]);

  useEffect(() => {
    if (user && canAccess("history") && (view === "workspace" || view === "history")) loadHistory();
  }, [user, view]);

  useEffect(() => {
    const permission = {
      dashboard: "dashboard", calculator: "calculator", financing: "financing", pricing: "pricing",
      cashflow: "cashflow", inventory: "inventory", commerce: "commerce", services: "services", clients: "clients", tasks: "tasks", history: "history",
    }[view];
    if (permission && !canAccess(permission)) setView("home");
    if (view === "team" && user?.access?.role !== "owner") setView("home");
  }, [view, user?.access?.role, user?.access?.permissions?.join(",")]);

  useEffect(() => {
    const navigation = sidebarNavRef.current;
    const activeItem = navigation?.querySelector(".nav-link.active");
    if (!navigation || !activeItem) return undefined;

    // Um único fundo se move entre os botões. Assim a seleção mantém contexto
    // visual e não parece que uma caixa desapareceu e outra surgiu do nada.
    const positionIndicator = () => {
      navigation.style.setProperty("--active-x", `${activeItem.offsetLeft}px`);
      navigation.style.setProperty("--active-y", `${activeItem.offsetTop}px`);
      navigation.style.setProperty("--active-width", `${activeItem.offsetWidth}px`);
      navigation.style.setProperty("--active-height", `${activeItem.offsetHeight}px`);
      navigation.dataset.indicatorReady = "true";
      activeItem.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    };
    const frame = requestAnimationFrame(positionIndicator);
    const observer = new ResizeObserver(positionIndicator);
    observer.observe(navigation);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [view, user?.access?.role, user?.access?.permissions?.join(","), isAdministrator]);

  function applyWorkspace(payload, { preserveFinancialCategories = false } = {}) {
    setInputs(payload.inputs);
    setCalculationType(payload.calculationType);
    setCashEntries(payload.cashEntries);
    setCashFilters(payload.cashFilters);
    setFinancialCategories((current) => preserveFinancialCategories
      ? normalizeFinancialCategories({
        ...payload,
        financialCategories: [...current, ...(payload.financialCategories || [])],
      })
      : payload.financialCategories);
    setFinancialCategoryRules(payload.financialCategoryRules);
    setOrganizationName(payload.organizationName);
    setSaveTitle(payload.saveTitle);
    setFinanceState(payload.financeState);
    setPricingState(payload.pricingState);
    setFinancialAccounts(payload.financialAccounts);
    setInventoryState(payload.inventoryState);
    setCommerceOrders(payload.commerceOrders);
    setActiveDocumentId(payload.activeDocumentId);
    setSavedFinancings(payload.savedFinancings);
    setInvoiceIssuer(payload.invoiceIssuer);
    setClients(payload.clients);
    setTasks(payload.tasks);
  }

  async function persistWorkspace(payload = workspacePayload, markSaved = false) {
    setSaveStatus("saving");
    const response = await fetch("/api/workspace", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload, markSaved }),
    });
    if (!response.ok) {
      setSaveStatus("error");
      return false;
    }
    lastSavedWorkspace.current = JSON.stringify(payload);
    setSaveStatus("saved");
    return true;
  }

  async function archiveCurrentWorkspace() {
    clearTimeout(autoSaveTimer.current);
    const response = await fetch("/api/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: workspacePayload }),
      keepalive: true,
    });
    if (response.ok) lastSavedWorkspace.current = JSON.stringify(workspacePayload);
    return response.ok;
  }

  function createFinancialCategory(value) {
    const category = String(value || "").trim().slice(0, 50);
    if (!category) {
      setNotice("Informe um nome para criar a categoria.");
      return false;
    }
    if (financialCategories.some((item) => item.toLocaleLowerCase("pt-BR") === category.toLocaleLowerCase("pt-BR"))) {
      setNotice(`A categoria ${category} já existe.`);
      return false;
    }
    setFinancialCategories((current) => [...current, category]);
    setNotice(`Categoria ${category} criada e disponível no Financeiro.`);
    return true;
  }
  async function loadHistory(type, { append = false, cursor = null } = {}) {
    setHistoryLoading(true);
    try {
      const search = new URLSearchParams();
      if (type) search.set("type", type);
      if (cursor) search.set("cursor", cursor);
      search.set("limit", "20");
      const response = await fetch(`/api/history?${search.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setHistory((current) => append ? [...current, ...data.items] : data.items);
        setHistoryNextCursor(data.nextCursor || null);
      }
    } finally {
      setHistoryLoading(false);
    }
  }

  async function startNewDocument(type) {
    const documentCount = history.filter((item) => item.calculation_type !== "rascunho-automatico").length;
    if (documentCount >= 10) {
      setNotice("Você atingiu o limite de 10 documentos. Exclua um documento antigo antes de criar outro.");
      setView("history");
      return;
    }
    // Antes de limpar a área atual, preserva sua última revisão no histórico da conta.
    await archiveCurrentWorkspace();
    // "Novo documento" limpa todo o workspace e é a única ação que remove o ID ativo.
    applyWorkspace(normalizeWorkspacePayload({ financialCategories }));
    if (type === "calculator") {
      setSaveTitle("Nova simulação financeira");
    } else if (type === "cashflow") {
      setOrganizationName("Nova organização financeira");
    }
    setNotice("");
    setView(type);
  }

  function changeAccountStatus(index, nextStatus) {
    const account = financialAccounts[index];
    if (!account) return;
    const settled = nextStatus === "pago" || nextStatus === "recebido";
    if (!settled) {
      if (commitmentAmounts(account).paid > 0 && !confirm("Reabrir esta conta? As baixas criadas pela conta serão removidas; lançamentos importados serão apenas desvinculados.")) return;
      setCashEntries((current) => current.flatMap((entry) => {
        if (entry.sourceCommitmentId !== account.id) return [entry];
        return entry.fingerprint ? [{ ...entry, sourceCommitmentId: undefined }] : [];
      }));
      setFinancialAccounts((current) => current.map((item, itemIndex) => itemIndex === index
        ? { ...item, status: "pendente", paidAmount: 0, postedAt: "" }
        : item));
      return;
    }
    recordAccountPayment(index, commitmentAmounts(account).balance);
  }

  function recordAccountPayment(index, paymentValue) {
    const account = financialAccounts[index];
    if (!account) return;
    const values = commitmentAmounts(account);
    const payment = Number(paymentValue);
    if (!(payment > 0) || payment - values.balance > 0.009) {
      setNotice("O pagamento precisa ser maior que zero e não pode ultrapassar o saldo da conta.");
      return;
    }
    if (!confirm(`Registrar ${money.format(payment)} nesta conta? O lançamento será incluído no caixa.`)) return;
    const cashType = account.type === "pagar" ? "saida" : "entrada";
    const commitmentId = account.id || globalThis.crypto?.randomUUID?.() || `commitment-${Date.now()}-${index}`;
    const nextPaid = Math.min(values.total, values.paid + payment);
    const fullySettled = values.total - nextPaid <= 0.009;
    setCashEntries((current) => [...current, {
      ...blankCashRow(),
      id: newWorkspaceEntityId("entry"),
      sourceCommitmentId: commitmentId,
      date: today(),
      category: account.category || "Geral",
      description: account.type === "receber"
        ? `${account.party || "Recebimento"}${fullySettled ? "" : " — pagamento parcial"}`
        : `${account.description || account.party || "Pagamento"}${fullySettled ? "" : " — pagamento parcial"}`,
      type: cashType,
      amount: payment,
    }]);
    setFinancialAccounts((current) => current.map((item, itemIndex) => itemIndex === index
      ? { ...item, id: commitmentId, paidAmount: nextPaid, status: fullySettled ? (item.type === "receber" ? "recebido" : "pago") : "parcial", postedAt: fullySettled ? new Date().toISOString() : "" }
      : item));
    setNotice(fullySettled ? "Conta quitada e lançamento salvo no caixa." : "Pagamento parcial salvo; o saldo continua pendente.");
  }

  function reconcileFinancialSuggestion(suggestion) {
    const entry = cashEntries[suggestion?.entryIndex];
    if (!entry || entry.sourceCommitmentId || entry.sourceOrderKey) return;
    const target = suggestion.targetType === "commitment"
      ? financialAccounts[suggestion.targetIndex]
      : commerceOrders[suggestion.targetIndex];
    if (!target) return;
    if (!confirm(`Conciliar “${entry.description}” com “${suggestion.targetLabel}”? O vínculo e a baixa serão salvos na organização.`)) return;
    const reconciledAt = new Date().toISOString();
    if (suggestion.targetType === "commitment") {
      const commitmentId = target.id || newWorkspaceEntityId("commitment");
      setCashEntries((current) => current.map((item, index) => index === suggestion.entryIndex
        ? { ...item, sourceCommitmentId: commitmentId, category: target.category || item.category || "Geral" }
        : item));
      setFinancialAccounts((current) => current.map((item, index) => index === suggestion.targetIndex
        ? { ...item, id: commitmentId, paidAmount: commitmentAmounts(item).total, status: item.type === "receber" ? "recebido" : "pago", postedAt: reconciledAt }
        : item));
      setNotice("Lançamento conciliado com a conta após sua confirmação.");
      return;
    }
    const orderKey = target.postingKey || target.id || newWorkspaceEntityId("order");
    setCashEntries((current) => current.map((item, index) => index === suggestion.entryIndex
      ? { ...item, sourceOrderKey: orderKey, category: target.type === "venda" ? "Vendas" : "Compras" }
      : item));
    setCommerceOrders((current) => current.map((item, index) => index === suggestion.targetIndex
      ? { ...item, id: item.id || orderKey, postingKey: orderKey, financePostedAt: reconciledAt, financeReversedAt: null, reconciledEntryId: entry.id || "" }
      : item));
    setNotice("Lançamento conciliado com o pedido após sua confirmação.");
  }

  function undoFinancialReconciliation(entryIndex) {
    const entry = cashEntries[entryIndex];
    if (!entry || (!entry.sourceCommitmentId && !entry.sourceOrderKey)) return;
    if (!confirm(`Desvincular “${entry.description || "este lançamento"}”? O lançamento bancário será mantido.`)) return;
    if (entry.sourceCommitmentId) {
      const remainingPaid = cashEntries.reduce((sum, item, index) => index !== entryIndex && item.sourceCommitmentId === entry.sourceCommitmentId
        ? sum + Math.abs(Number(item.amount) || 0)
        : sum, 0);
      setFinancialAccounts((current) => current.map((item) => {
        if (item.id !== entry.sourceCommitmentId) return item;
        const total = commitmentAmounts(item).total;
        const paidAmount = Math.min(total, remainingPaid);
        const settled = total > 0 && total - paidAmount <= 0.009;
        return { ...item, paidAmount, status: settled ? (item.type === "receber" ? "recebido" : "pago") : paidAmount > 0 ? "parcial" : "pendente", postedAt: settled ? item.postedAt || new Date().toISOString() : "" };
      }));
    }
    if (entry.sourceOrderKey) {
      setCommerceOrders((current) => current.map((item) => (item.postingKey || item.id) === entry.sourceOrderKey
        ? { ...item, financePostedAt: null, financeReversedAt: null, reconciledEntryId: "" }
        : item));
    }
    setCashEntries((current) => current.map((item, index) => index === entryIndex
      ? { ...item, sourceCommitmentId: undefined, sourceOrderKey: undefined }
      : item));
    setNotice("Conciliação desfeita; o lançamento bancário foi preservado.");
  }

  async function scanBillImage(file) {
    if (!file) return;
    // TextDetector mantém a imagem no aparelho; quando indisponível, nenhuma leitura é inventada.
    if (!("TextDetector" in window)) {
      setNotice("A câmera foi reconhecida, mas este navegador não oferece OCR seguro. Para leitura automática será necessário conectar Google Vision, Azure Document Intelligence ou outro provedor de OCR.");
      return;
    }
    setNotice("Lendo a imagem…");
    try {
      const bitmap = await createImageBitmap(file);
      const blocks = await new window.TextDetector().detect(bitmap);
      const text = blocks.map((block) => block.rawValue).join("\n");
      const values = [...text.matchAll(/(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2})/g)]
        .map((match) => Number(match[1].replaceAll(".", "").replace(",", ".")))
        .filter(Number.isFinite);
      const amount = values.length ? Math.max(...values) : "";
      const description = text.split("\n").find((line) => line.trim().length > 2)?.trim() || "Conta digitalizada";
      if (!confirm(`Leitura sugerida: ${description}${amount ? ` · ${money.format(amount)}` : ""}. Criar conta a pagar para revisão?`)) return;
      setFinancialAccounts((current) => [...current, { ...emptyFinancialAccount(), id: `${Date.now()}`, description, amount }]);
      setNotice("Pré-cadastro criado. Confira fornecedor, vencimento e valor antes de dar baixa.");
    } catch {
      setNotice("Não foi possível ler esta imagem. Nenhum lançamento foi criado.");
    }
  }

  function changeOrderStatus(index, nextStatus) {
    const order = commerceOrders[index];
    if (!order) return;
    const postingKey = order.postingKey || order.id || `order-${Date.now()}-${index}`;
    const findProductIndex = () => inventoryState.products.findIndex((product) =>
      (order.productId && product.id && String(product.id) === String(order.productId)) ||
      (order.sku && product.sku && product.sku.trim().toLowerCase() === String(order.sku).trim().toLowerCase()) ||
      (order.productName && product.name && product.name.trim().toLowerCase() === String(order.productName).trim().toLowerCase()));

    // Cancelar um pedido já lançado desfaz somente os movimentos criados por ele.
    if (nextStatus === "cancelado" && ((order.stockUpdatedAt && !order.stockReversedAt) || (order.financePostedAt && !order.financeReversedAt))) {
      const productIndex = findProductIndex();
      if (order.stockUpdatedAt && !order.stockReversedAt && productIndex >= 0 && Number.isFinite(Number(order.stockDelta))) {
        setInventoryState((current) => ({ ...current, products: current.products.map((item, itemIndex) => itemIndex === productIndex
          ? { ...item, quantity: String((Number(item.quantity) || 0) - Number(order.stockDelta)) }
          : item) }));
      }
      setCashEntries((current) => current.filter((entry) => entry.sourceOrderKey !== postingKey));
      setCommerceOrders((current) => current.map((item, itemIndex) => itemIndex === index ? {
        ...item, status: "cancelado", postingKey,
        stockReversedAt: item.stockUpdatedAt ? new Date().toISOString() : item.stockReversedAt,
        financeReversedAt: item.financePostedAt ? new Date().toISOString() : item.financeReversedAt,
      } : item));
      setNotice("Pedido cancelado. Os movimentos automáticos identificados foram retirados do estoque e do caixa.");
      return;
    }
    if (nextStatus !== "concluido" || order.status === "concluido") {
      setCommerceOrders((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, status: nextStatus } : item));
      return;
    }
    // Um pedido já contabilizado não pode movimentar o estoque duas vezes.
    if (order.stockUpdatedAt && !order.stockReversedAt) {
      setCommerceOrders((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, status: nextStatus } : item));
      setNotice("Pedido reaberto sem repetir a movimentação já registrada no estoque.");
      return;
    }
    const quantity = Number(order.quantity);
    const productIndex = findProductIndex();
    let stockDelta = 0;
    if (!(quantity > 0) || productIndex < 0) {
      if (!confirm("Produto ou quantidade não corresponde ao estoque. Concluir o pedido sem alterar o estoque?")) return;
    } else {
      const product = inventoryState.products[productIndex];
      const currentQuantity = Number(product.quantity) || 0;
      stockDelta = order.type === "venda" ? -quantity : quantity;
      const nextQuantity = currentQuantity + stockDelta;
      const verb = order.type === "venda" ? "retirar" : "adicionar";
      const negativeWarning = nextQuantity < 0 ? ` Isso deixará o estoque em ${nextQuantity}.` : "";
      const financeMessage = Number(order.amount) > 0 ? ` O valor de ${money.format(Number(order.amount))} também será lançado no Financeiro.` : "";
      if (!confirm(`Concluir o pedido e ${verb} ${quantity} unidade(s) do estoque de ${product.name || product.sku}?${negativeWarning}${financeMessage}`)) return;
      setInventoryState((current) => ({ ...current, products: current.products.map((item, itemIndex) => itemIndex === productIndex ? { ...item, quantity: String(nextQuantity) } : item) }));
    }
    const postedAt = new Date().toISOString();
    if (Number(order.amount) > 0 && canAccess("cashflow")) {
      setCashEntries((current) => current.some((entry) => entry.sourceOrderKey === postingKey) ? current : [...current, {
        ...blankCashRow(), id: newWorkspaceEntityId("entry"), sourceOrderKey: postingKey,
        date: order.date || today(), category: order.type === "venda" ? "Vendas" : "Compras",
        description: `${order.type === "venda" ? "Venda" : "Compra"} ${order.number || order.productName || order.sku || "comercial"}`,
        type: order.type === "venda" ? "entrada" : "saida", amount: String(Math.abs(Number(order.amount))),
      }]);
    }
    setCommerceOrders((current) => current.map((item, itemIndex) => itemIndex === index ? {
      ...item, status: nextStatus, postingKey, stockDelta,
      stockUpdatedAt: productIndex >= 0 && quantity > 0 ? postedAt : item.stockUpdatedAt,
      stockReversedAt: null,
      financePostedAt: Number(order.amount) > 0 && canAccess("cashflow") ? postedAt : item.financePostedAt,
      financeReversedAt: null,
    } : item));
    setNotice("Pedido concluído: estoque atualizado e movimento financeiro lançado sem duplicação.");
  }

  async function downloadTestInvoice(order) {
    if (order?.type !== "venda") {
      setNotice("O documento comercial de produto é emitido para pedidos de venda.");
      return;
    }
    if (!invoiceIssuer.legalName || !order.partner || !(Number(order.amount) > 0) || !(Number(order.quantity) > 0)) {
      setNotice("Preencha emitente, cliente, quantidade e valor antes de gerar o PDF.");
      return;
    }
    const filename = await requestFileName({
      suggestedName: `pre-nota-${order.number || "pedido"}`,
      extension: "pdf",
      description: "Escolha como esta pré-nota será identificada no seu dispositivo.",
    });
    if (!filename) return;
    const product = inventoryState.products.find((item) =>
      item.sku && item.sku.trim().toLowerCase() === String(order.sku || "").trim().toLowerCase(),
    );
    const response = await fetch("/api/export/pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      title: `Pré-nota ${order.number || "sem número"}`,
      calculationType: "pre-nota-produto",
      filename,
      payload: { commercialDocument: {
        issuer: invoiceIssuer,
        customer: { name: order.partner, contact: order.contact },
        orderNumber: order.number || "Sem número",
        issueDate: order.date || today(),
        items: [{
          sku: order.sku || "",
          description: product?.name || order.description || "Produto",
          quantity: Number(order.quantity),
          unitPrice: Number(order.amount) / Number(order.quantity),
          total: Number(order.amount),
        }],
        total: Number(order.amount),
        disclaimer: "PRÉ-NOTA / DOCUMENTO COMERCIAL - SEM VALIDADE FISCAL",
      } },
    }) });
    if (!response.ok) return setNotice("Não foi possível gerar a pré-nota em PDF.");
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    setNotice("Pré-nota em PDF baixada. Ela não substitui XML autorizado nem DANFE fiscal.");
  }

  function suggestOrdersFromCash() {
    const suggestions = ordersFromCashEntries(cashEntries, commerceOrders);
    if (!suggestions.length) {
      setNotice("Não há novos lançamentos do extrato para transformar em pedidos.");
      return;
    }
    setCommerceOrders((current) => [...current, ...suggestions]);
    setNotice(`${suggestions.length} pedido(s) criado(s) como rascunho. Revise e edite antes de confirmar.`);
  }

  function selectedExportRows() {
    const rows = [];
    if (exportSections.calculations) {
      result.table.filter((item) => Number(item.flow)).forEach((item) => rows.push({ secao: "Cálculos", descricao: `Período ${item.period}`, data: item.date, valor: item.flow, status: calculationType }));
      financialTableResult.rows.forEach((item) => rows.push({ secao: "Financiamentos", descricao: `Parcela ${item.period}`, data: item.date, valor: -Math.abs(Number(item.payment) || 0), status: financeState.system }));
    }
    if (exportSections.finance) {
      financialAccounts.filter((item) => item.description || Number(item.amount)).forEach((item) => { const values = commitmentAmounts(item); rows.push({ secao: "Contas e cobranças", descricao: item.description || item.party, data: item.dueDate, valor: item.type === "pagar" ? -values.balance : values.balance, status: item.status }); });
      cashEntries.filter((item) => item.description || Number(item.amount)).forEach((item) => rows.push({ secao: "Fluxo de caixa", descricao: item.description, data: item.date, valor: item.type === "saida" ? -Number(item.amount) : Number(item.amount), status: item.category }));
    }
    if (exportSections.inventory) {
      inventoryState.products.filter((item) => item.name || item.sku).forEach((item) => rows.push({ secao: "Estoque", descricao: `${item.name} · SKU ${item.sku}`, data: "", valor: item.quantity, status: item.location }));
      inventoryState.deliveries.filter((item) => item.description).forEach((item) => rows.push({ secao: "Logística", descricao: item.description, data: item.date, valor: "", status: item.status }));
    }
    if (exportSections.commerce) commerceOrders.filter((item) => item.number || item.partner || Number(item.amount)).forEach((item) => rows.push({ secao: item.type === "venda" ? "Vendas" : "Compras", descricao: `${item.number || "Pedido"} · ${item.partner}`, data: item.date, valor: item.type === "compra" ? -Math.abs(Number(item.amount) || 0) : Math.abs(Number(item.amount) || 0), status: item.status }));
    return rows;
  }

  async function exportSelected(format) {
    const rows = selectedExportRows();
    if (!rows.length) return setNotice("As seções selecionadas ainda não possuem dados para exportar.");
    const extension = format === "drive" ? "xlsx" : format;
    const filename = await requestFileName({
      suggestedName: "relatorio-selecionado",
      extension,
      description: format === "drive" ? "Este será o nome exibido no seu Google Drive." : "Este será o nome do arquivo baixado.",
    });
    if (!filename) return;
    const report = { title: "Relatório operacional selecionado", calculationType: "exportacao-selecionada", payload: { table: rows } };
    if (format === "drive") {
      const item = await createModuleHistory({ ...report, success: "Seleção preparada para o Google Drive.", navigate: false });
      if (!item) return;
      if (driveStatus.connected) await sendHistoryToDrive(item, filename); else connectGoogleDrive(item, filename);
      return;
    }
    if (format === "pdf") {
      const response = await fetch("/api/export/pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...report, filename }) });
      if (!response.ok) return setNotice("Não foi possível gerar o PDF selecionado.");
      const url = URL.createObjectURL(await response.blob()); const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      return setNotice("PDF das seções selecionadas baixado.");
    }
    const safe = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const csv = ["sep=;", Object.keys(rows[0]).map(safe).join(";"), ...rows.map((row) => Object.values(row).map(safe).join(";"))].join("\r\n");
    const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" })); const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    setNotice("CSV das seções selecionadas baixado.");
  }
  async function saveActiveDocument({ title, calculationType: type, payload, success, navigate = true, workspace = workspacePayload }) {
    const idempotencyKey = globalThis.crypto?.randomUUID?.() || `history-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const response = await fetch("/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({
        id: activeDocumentId,
        title,
        calculationType: type,
        // O snapshot completo permite reabrir o documento sem perder dados de outros módulos.
        payload: { ...payload, workspace },
      }),
    });
    const data = await response.json().catch(() => ({}));
    setNotice(response.ok ? success : data.error || "Não foi possível salvar o documento.");
    if (!response.ok) return null;

    setActiveDocumentId(data.item.id);
    await persistWorkspace({ ...workspace, activeDocumentId: data.item.id }, true);
    if (navigate) setView("history");
    return data.item;
  }

  async function saveCalculation() {
    const hasFinancialTable =
      Number(financeState.form.principal) > 0 &&
      Number(financeState.form.periods) > 0;
    await saveActiveDocument({
      title: saveTitle,
      calculationType,
      payload: {
        inputs,
        result,
        table: result.table,
        // Se a pessoa preencheu a tabela financeira, estado e memória ficam no mesmo documento.
        financeState: hasFinancialTable ? financeState : undefined,
        financialTable: hasFinancialTable
          ? { state: financeState, result: financialTableResult }
          : undefined,
        financialTables: savedFinancings,
      },
      success: "Cálculo atualizado no histórico da sua conta.",
    });
  }
  async function createModuleHistory({ title, calculationType, payload, success, navigate = true, workspace = workspacePayload }) {
    // Todos os módulos usam a mesma rota para manter validação, limite e vínculo com a conta.
    return saveActiveDocument({ title, calculationType, payload, success, navigate, workspace });
  }
  async function saveFinancialTable() {
    if (!financialTableResult.rows.length) {
      setNotice("Preencha o valor financiado e a quantidade de parcelas antes de salvar.");
      return;
    }
    const financingId = financeState.id || globalThis.crypto?.randomUUID?.() || `financing-${Date.now()}`;
    const nextFinanceState = { ...financeState, id: financingId };
    // Guardamos apenas as premissas na coleção; as parcelas são recalculadas ao exportar para economizar banco.
    const financing = { id: financingId, state: nextFinanceState };
    const nextFinancings = [
      ...savedFinancings.filter((item) => item.id !== financingId),
      financing,
    ];
    const nextWorkspace = { ...workspacePayload, financeState: nextFinanceState, savedFinancings: nextFinancings };
    setFinanceState(nextFinanceState);
    setSavedFinancings(nextFinancings);
    await createModuleHistory({
      title: `Tabela ${financeState.system}`,
      calculationType: "tabela-financeira",
      payload: {
        financeState: nextFinanceState,
        financialTable: { ...financing, result: financialTableResult },
        financialTables: nextFinancings,
        table: financialTableResult.rows,
      },
      workspace: nextWorkspace,
      success: "Financiamento atualizado no documento da sua conta.",
    });
  }
  async function exportFinancialTableToDrive() {
    if (!financialTableResult.rows.length) {
      setNotice("Preencha o valor financiado e a quantidade de parcelas antes de exportar.");
      return;
    }
    const filename = await requestFileName({
      suggestedName: `tabela-${financeState.system.toLowerCase()}`,
      extension: "xlsx",
      description: "Este será o nome da tabela no seu Google Drive.",
    });
    if (!filename) return;
    const financingId = financeState.id || globalThis.crypto?.randomUUID?.() || `financing-${Date.now()}`;
    const nextFinanceState = { ...financeState, id: financingId };
    const financing = { id: financingId, state: nextFinanceState };
    const nextFinancings = [...savedFinancings.filter((entry) => entry.id !== financingId), financing];
    const nextWorkspace = { ...workspacePayload, financeState: nextFinanceState, savedFinancings: nextFinancings };
    setFinanceState(nextFinanceState);
    setSavedFinancings(nextFinancings);
    const item = await createModuleHistory({
      title: `Tabela ${financeState.system}`,
      calculationType: "tabela-financeira",
      payload: {
        financeState: nextFinanceState,
        financialTable: { ...financing, result: financialTableResult },
        financialTables: nextFinancings,
        table: financialTableResult.rows,
      },
      workspace: nextWorkspace,
      success: "Tabela salva. Preparando o envio ao Google Drive…",
      navigate: false,
    });
    if (!item) return;
    // Se ainda não houver conexão, o OAuth guarda este ID e retoma o envio no retorno.
    if (driveStatus.connected) await sendHistoryToDrive(item, filename);
    else connectGoogleDrive(item, filename);
  }
  async function savePricing() {
    if (!(Number(pricingState.units) > 0) || !(pricingResult.totalCost > 0)) {
      setNotice("Adicione despesas e uma quantidade de unidades antes de salvar.");
      return;
    }
    await createModuleHistory({
      title: "Preço do produto",
      calculationType: "preco-produto",
      payload: { pricingState, pricingResult },
      success: "Precificação salva no histórico da sua conta.",
    });
  }
  async function saveCashFlow() {
    const normalized = cashEntries.map((entry) => ({
      ...entry,
      amount: Number(entry.amount) || 0,
    }));
    await saveActiveDocument({
      title: organizationName || "Organização financeira",
      calculationType: "fluxo-caixa",
      payload: { organizationName, entries: normalized, table: normalized },
      success: "Organização financeira atualizada no documento da sua conta.",
    });
  }
  async function deleteHistory(id) {
    if (!confirm("Excluir este registro salvo?")) return;
    const response = await fetch(`/api/history/${id}`, { method: "DELETE" });
    if (response.ok) {
      setHistory(history.filter((item) => item.id !== id));
      if (activeDocumentId === id) setActiveDocumentId(null);
    }
  }
  async function connectGoogleDrive(item, providedFilename = "") {
    const filename = providedFilename || await requestFileName({
      suggestedName: item.title || "relatorio-candtech",
      extension: "xlsx",
      description: "Este será o nome exibido no seu Google Drive.",
    });
    if (!filename) return;
    // Guarda no fluxo OAuth qual arquivo deve ser enviado após a conexão.
    window.location.assign(`/api/google-drive/connect?historyId=${encodeURIComponent(item.id)}&filename=${encodeURIComponent(filename)}`);
  }
  async function sendHistoryToDrive(item, providedFilename = "") {
    const filename = providedFilename || await requestFileName({
      suggestedName: item.title || "relatorio-candtech",
      extension: "xlsx",
      description: "Este será o nome exibido no seu Google Drive.",
    });
    if (!filename) return;
    setDriveUpload({ id: item.id, status: "sending", file: null });
    setNotice("Enviando a planilha Excel ao Google Drive…");
    const response = await fetch(`/api/history/${item.id}/drive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename }),
    });
    const data = await response.json();
    if (response.ok) {
      // Mantém um comprovante visível no próprio item, incluindo o link devolvido pelo Google.
      setDriveUpload({ id: item.id, status: "sent", file: data.file });
      setNotice(`Arquivo ${data.file.name} enviado ao seu Google Drive.`);
      return;
    }
    setDriveUpload({ id: item.id, status: "error", file: null });
    if (data.reconnect) setDriveStatus((current) => ({ ...current, connected: false }));
    setNotice(data.error || "Não foi possível enviar ao Google Drive.");
  }
  async function disconnectGoogleDrive() {
    if (!confirm("Desconectar o Google Drive desta conta?")) return;
    const response = await fetch("/api/google-drive/status", { method: "DELETE" });
    if (response.ok) {
      setDriveStatus((current) => ({ ...current, connected: false }));
      setNotice("Google Drive desconectado desta conta.");
    }
  }
  async function downloadHistoryFile(item, format) {
    const filename = await requestFileName({
      suggestedName: item.title || `historico-${item.id}`,
      extension: format,
      description: "Escolha um nome para este arquivo do histórico.",
    });
    if (!filename) return;
    setFileDownload({ id: item.id, format });
    setNotice(`Preparando arquivo ${format.toUpperCase()}…`);
    try {
      const response = await fetch(`/api/history/${item.id}/${format}?filename=${encodeURIComponent(filename)}`);
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || `Falha ao gerar ${format.toUpperCase()}.`);
      }
      const blob = await response.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      const objectUrl = link.href;
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
      setNotice(`${format.toUpperCase()} baixado com sucesso.`);
    } catch (error) {
      setNotice(error.message || "Não foi possível baixar o arquivo.");
    } finally {
      setFileDownload({ id: null, format: null });
    }
  }
  async function logout() {
    // Arquiva a última revisão antes de destruir a sessão da conta.
    await archiveCurrentWorkspace();
    await fetch("/api/auth/me", { method: "DELETE" });
    applyWorkspace(normalizeWorkspacePayload());
    lastSavedWorkspace.current = "";
    setHistory([]);
    setNotice("");
    setWorkspaceReady(false);
    setUser(null);
    setView("home");
  }
  function updateFlow(index, field, value) {
    // Atualiza data ou valor da linha; useMemo recalcula tabela e gráfico imediatamente.
    setInputs((current) => {
      const flows = current.flows.map(normalizeProjectionFlow);
      flows[index] = { ...flows[index], [field]: value };
      return { ...current, flows };
    });
  }
  function updatePeriods(value) {
    // Mantém a quantidade de campos e a tabela sincronizadas com o número de períodos.
    const parsed = Number.parseInt(value, 10);
    const count =
      value === ""
        ? 0
        : Math.min(120, Math.max(1, Number.isFinite(parsed) ? parsed : 1));
    setInputs((current) => {
      const flows = Array.from({ length: count }, (_, index) =>
        normalizeProjectionFlow(current.flows[index], index),
      );
      return { ...current, periods: value === "" ? "" : String(count), flows };
    });
  }
  function addFlow() {
    // Usa o tamanho real do array para o botão funcionar mesmo com períodos inicialmente vazio.
    setInputs((current) => {
      const flows = [
        ...current.flows.map(normalizeProjectionFlow),
        normalizeProjectionFlow(null, current.flows.length),
      ];
      return { ...current, periods: String(flows.length), flows };
    });
  }
  function loadCalculation(item) {
    // Converte registros antigos para o novo formato com data e valor por período.
    const saved = item.payload.inputs;
    setInputs({
      ...saved,
      investmentDate: saved.investmentDate || today(),
      flows: (saved.flows || []).map(normalizeProjectionFlow),
    });
    setCalculationType(item.calculation_type === "ROI" ? "VPL" : item.calculation_type);
    const savedFinanceState =
      item.payload.financeState || item.payload.financialTable?.state;
    if (savedFinanceState) {
      setFinanceState(normalizeWorkspacePayload({ financeState: savedFinanceState }).financeState);
    }
    setSaveTitle(item.title);
    setActiveDocumentId(item.id);
    setView("calculator");
  }
  function loadHistoryItem(item) {
    setActiveDocumentId(item.id);
    if (item.payload.workspace) {
      // Documentos novos carregam o workspace completo e continuam usando o mesmo ID ao salvar.
      applyWorkspace(
        normalizeWorkspacePayload({ ...item.payload.workspace, activeDocumentId: item.id }),
        { preserveFinancialCategories: true },
      );
      const targetView = {
        "tabela-financeira": "financing",
        "preco-produto": "pricing",
        "fluxo-caixa": "cashflow",
        "organizacao-financeira": "cashflow",
        estoque: "inventory",
        "vendas-compras": "commerce",
      }[item.calculation_type] || "calculator";
      setView(targetView);
      return;
    }
    // Cada tipo volta para a aba em que foi criado, sem misturar módulos diferentes.
    if (item.payload.financialTable && !item.payload.inputs) {
      setFinanceState(normalizeWorkspacePayload({ financeState: item.payload.financialTable.state }).financeState);
      setView("financing");
      return;
    }
    if (item.payload.pricingState) {
      setPricingState(normalizeWorkspacePayload({ pricingState: item.payload.pricingState }).pricingState);
      setView("pricing");
      return;
    }
    if (item.payload.entries) {
      setCashEntries(item.payload.entries);
      setOrganizationName(item.payload.organizationName || item.title);
      setView("cashflow");
      return;
    }
    if (item.payload.inputs) loadCalculation(item);
  }

  async function downloadCurrentCsv() {
    const reports = {
      dashboard: { filename: "visao-geral.csv", title: "Visão geral", rows: result.table, totalSpent: result.totalOutflows },
      calculator: { filename: "calculadora.csv", title: saveTitle, rows: result.table, totalSpent: result.totalOutflows },
      financing: { filename: `tabela-${financeState.system.toLowerCase()}.csv`, title: `Tabela ${financeState.system}`, rows: financialTableResult.rows, totalSpent: financialTableResult.totalPaid },
      pricing: {
        filename: "preco-produto.csv", title: "Preço do produto",
        rows: [
          { item: "Produto", valor: pricingState.productName || "Não informado" },
          { item: "SKU / código", valor: pricingState.sku || "Não informado" },
          ...pricingState.expenses.map((expense) => ({ item: expense.name, valor: -Math.abs(Number(expense.amount) || 0) })),
          { item: "Quantidade produzida", valor: pricingResult.quantity },
          { item: "Custo total do produto", valor: pricingResult.totalCost },
          { item: "Custo unitário", valor: pricingResult.unitCost },
          { item: "Margem de lucro (%)", valor: Number(pricingState.margin) || 0 },
          { item: "Preço unitário", valor: pricingResult.unitPrice },
          { item: "Lucro unitário", valor: pricingResult.unitProfit },
          { item: "Faturamento esperado", valor: pricingResult.expectedRevenue },
        ], totalSpent: -Math.abs(pricingResult.totalCost),
      },
      cashflow: {
        filename: "organizacao-financeira.csv",
        title: organizationName,
        rows: [
          ...financialAccounts.map((item) => { const values = commitmentAmounts(item); return { registro: "Conta", tipo: item.type, descricao: item.description, parceiro: item.party, data: item.dueDate, valor: item.type === "pagar" ? -values.balance : values.balance, status: item.status }; }),
          ...cashEntries.map((item) => ({ registro: "Caixa", tipo: item.type, descricao: item.description, parceiro: item.category, data: item.date, valor: item.type === "saida" ? -Math.abs(Number(item.amount) || 0) : Math.abs(Number(item.amount) || 0), status: "realizado" })),
        ],
        totalSpent: -cashEntries.reduce(
          (sum, entry) => sum + (entry.type === "saida" ? Number(entry.amount) || 0 : 0),
          0,
        ),
      },
      inventory: {
        filename: "estoque-logistica.csv", title: "Estoque e logÃ­stica",
        rows: [
          ...inventoryState.products.map((item) => ({ registro: "Produto", nome: item.name, codigo: item.sku, quantidade: item.quantity, referencia: item.minimum, valor: item.unitCost, status: item.location })),
          ...inventoryState.deliveries.map((item) => ({ registro: "Entrega", nome: item.description, codigo: item.tracking, quantidade: "", referencia: item.partner, valor: "", status: item.status })),
        ],
        totalSpent: inventoryState.products.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unitCost) || 0), 0),
        summaryLabel: "Valor estimado do estoque",
      },
      commerce: {
        filename: "pedidos-vendas.csv", title: "Pedidos e vendas", rows: commerceOrders.map((item) => ({ ...item, amount: item.type === "compra" ? -Math.abs(Number(item.amount) || 0) : Math.abs(Number(item.amount) || 0) })),
        totalSpent: -commerceOrders.reduce((sum, item) => sum + (item.type === "compra" && item.status !== "cancelado" ? Number(item.amount) || 0 : 0), 0),
        summaryLabel: "Total dos pedidos de compra",
      },
    };
    const report = reports[view];
    if (!report) return;
    const filename = await requestFileName({
      suggestedName: report.filename,
      extension: "csv",
      description: "Escolha o nome do relatório CSV.",
    });
    if (!filename) return;
    const headers = report.rows.length ? Object.keys(report.rows[0]) : ["informação"];
    const safeCell = (value) => {
      const text = String(value ?? "");
      const protectedText = /^[=+\-@]/.test(text) ? `'${text}` : text;
      return `"${protectedText.replaceAll('"', '""')}"`;
    };
    const csv = [
      "sep=;",
      ["Relatório", report.title].map(safeCell).join(";"),
      "",
      headers.map(safeCell).join(";"),
      ...report.rows.map((row) => headers.map((key) => safeCell(row[key])).join(";")),
      "",
      [report.summaryLabel || "Total gasto", report.totalSpent].map(safeCell).join(";"),
    ].join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
    link.download = filename;
    link.click();
    const objectUrl = link.href;
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
  }

  async function downloadCurrentPdf() {
    const meaningfulFlows = result.table.filter((row) => Number(row.flow) !== 0);
    const meaningfulEntries = cashEntries.filter(
      (entry) => entry.description || Number(entry.amount) > 0,
    );
    const meaningfulAccounts = financialAccounts.filter(
      (account) => account.description || account.party || Number(account.amount) > 0,
    );
    const reports = {
      dashboard: meaningfulFlows.length
        ? {
            title: "Visão geral financeira",
            calculationType: "visao-geral",
            payload: { inputs, result, table: result.table },
          }
        : null,
      calculator: meaningfulFlows.length
        ? {
            title: saveTitle || "Cálculo financeiro",
            calculationType,
            payload: { inputs, result, table: result.table },
          }
        : null,
      financing: financialTableResult.rows.length
        ? {
            title: `Tabela ${financeState.system}`,
            calculationType: "tabela-financeira",
            payload: {
              table: financialTableResult.rows,
              financialTable: { state: financeState, result: financialTableResult },
            },
          }
        : null,
      pricing:
        pricingResult.totalCost > 0 && Number(pricingState.units) > 0
          ? {
              title: "Preço do produto",
              calculationType: "preco-produto",
              payload: { pricingState, pricingResult },
            }
          : null,
      cashflow: meaningfulEntries.length || meaningfulAccounts.length
        ? {
            title: organizationName || "Organização financeira",
            calculationType: "organizacao-financeira",
            payload: {
              entries: meaningfulEntries,
              accounts: meaningfulAccounts,
              table: [
                ...meaningfulAccounts.map((item) => ({ registro: "Conta", tipo: item.type, descricao: item.description, data: item.dueDate, valor: item.amount, status: item.status })),
                ...meaningfulEntries.map((item) => ({ registro: "Caixa", tipo: item.type, descricao: item.description, data: item.date, valor: item.amount, status: "realizado" })),
              ],
              summary: [
                { label: "Entradas", value: cashTotals.income, format: "currency" },
                { label: "Saídas", value: cashTotals.expense, format: "currency" },
                {
                  label: "Saldo",
                  value: cashTotals.income - cashTotals.expense,
                  format: "currency",
                },
              ],
            },
          }
        : null,
      inventory: [...inventoryState.products, ...inventoryState.deliveries].some((item) => item.name || item.description || item.sku)
        ? { title: "Estoque e logÃ­stica", calculationType: "estoque-logistica", payload: { table: [
            ...inventoryState.products.map((item) => ({ tipo: "Produto", nome: item.name, codigo: item.sku, quantidade: item.quantity, minimo: item.minimum, custoUnitario: item.unitCost, localizacao: item.location })),
            ...inventoryState.deliveries.map((item) => ({ tipo: "Entrega", nome: item.description, codigo: item.tracking, quantidade: "", minimo: "", custoUnitario: "", localizacao: `${item.partner} · ${item.status}` })),
          ] } }
        : null,
      commerce: commerceOrders.some((item) => item.number || item.partner || Number(item.amount))
        ? { title: "Pedidos e vendas", calculationType: "vendas-compras", payload: { table: commerceOrders } }
        : null,
    };
    const report = reports[view];
    if (!report) {
      setNotice("Preencha e calcule os dados desta aba antes de gerar o PDF.");
      return;
    }
    const filename = await requestFileName({
      suggestedName: `candtech-${view}`,
      extension: "pdf",
      description: "Escolha o nome do relatório PDF.",
    });
    if (!filename) return;
    setCurrentPdfLoading(true);
    setNotice("Gerando relatório PDF…");
    try {
      const response = await fetch("/api/export/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...report, filename }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Não foi possível gerar o PDF.");
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
      setNotice("PDF baixado com sucesso.");
    } catch (error) {
      setNotice(error.message || "Não foi possível baixar o PDF.");
    } finally {
      setCurrentPdfLoading(false);
    }
  }
  function restoreAutomaticDraft(item) {
    const restored = normalizeWorkspacePayload(item.payload);
    applyWorkspace(restored, { preserveFinancialCategories: true });
    setNotice("Rascunho restaurado. As alterações voltarão a ser salvas automaticamente.");
    setView("home");
  }
  function resetOperationalSections(sections) {
    // A limpeza é voluntária e afeta somente as áreas marcadas do documento atual.
    if (sections.finance) {
      setCashEntries([blankCashRow()]);
      setFinancialAccounts([emptyFinancialAccount()]);
      setCashFilters({ month: "", type: "todos", category: "todos" });
    }
    if (sections.inventory) setInventoryState(emptyInventoryState());
    if (sections.commerce) setCommerceOrders([emptyCommerceOrder()]);
    setNotice("Novo ciclo iniciado nas áreas selecionadas. O salvamento automático atualizará este documento.");
  }
  // O fallback vem do Server Component da página inicial. Crawlers e pessoas sem
  // JavaScript recebem conteúdo útil enquanto a sessão é verificada.
  if (checking)
    return publicFallback || <div className="loading">Verificando sua sessão…</div>;
  if (user && !user.emailVerified)
    return <EmailVerificationScreen user={user} onVerified={completeAuthentication} onLogout={switchInvitationAccount} />;
  if (user && !user.legalAccepted)
    return <LegalAcceptanceScreen onAccepted={setUser} onLogout={switchInvitationAccount} />;
  if (user && user.mfaRequired && (!user.mfaEnabled || !user.mfaVerified))
    return <MfaEnrollmentScreen user={user} onCompleted={async () => setUser(await hydrateAuthenticatedUser())} onLogout={switchInvitationAccount} />;
  if (inviteToken && !inviteComplete)
    return (
      <AuthScreen
        onAuthenticated={completeAuthentication}
        inviteToken={inviteToken}
        authenticatedUser={user}
        onSwitchAccount={switchInvitationAccount}
      />
    );
  if (user && user.subscriptionRequired && !user.subscriptionActive)
    return user.administrator && user.monitoringPath
      ? <AdministrativeAccessScreen user={user} onLogout={switchInvitationAccount} />
      : <PaymentRequiredScreen user={user} onLogout={switchInvitationAccount} />;
  if (user && !workspaceReady)
    return <div className="loading">Carregando os dados da sua conta…</div>;
  if (!user) {
    if (publicFallback && !authRequested) return publicFallback;
    return <AuthScreen onAuthenticated={completeAuthentication} inviteToken={inviteToken} />;
  }
  const filteredCashEntries = cashEntries
    .map((entry, originalIndex) => ({ ...entry, originalIndex }))
    .filter(
      (entry) =>
        (!cashFilters.month || entry.date.startsWith(cashFilters.month)) &&
        (cashFilters.type === "todos" || entry.type === cashFilters.type) &&
        (cashFilters.category === "todos" ||
          entry.category === cashFilters.category),
    )
    // A tabela e os gráficos sempre seguem a cronologia, inclusive após importar PDF.
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const cashTotals = filteredCashEntries.reduce(
    (totals, entry) => ({
      income:
        totals.income +
        (entry.type === "entrada" ? Number(entry.amount || 0) : 0),
      expense:
        totals.expense +
        (entry.type === "saida" ? Number(entry.amount || 0) : 0),
    }),
    { income: 0, expense: 0 },
  );
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-mark" src="/candtech-mark.svg" alt="" /> CandTech
        </div>
        <div className="workspace">{user.access?.organizationName || (user.accountType === "company" ? "Gestão empresarial" : "Gestão pessoal")}</div>
        <nav ref={sidebarNavRef} aria-label="Navegação principal">
          {[
            ["home", "Hoje", "⌂"],
            ["workspace", "Workspace", "□"],
            ...(canAccess("clients") ? [["clients", "Clientes", "♧"]] : []),
            ...(canAccess("tasks") ? [["tasks", "Tarefas", "✓"]] : []),
            ...(canAccess("commerce") ? [["commerce", "Pedidos e vendas", "⇄"]] : []),
            ...(canAccess("services") ? [["services", "Ordens de serviço", "⌘"]] : []),
            ...(canAccess("inventory") ? [["inventory", "Logística e estoque", "▣"]] : []),
            ...(canAccess("cashflow") ? [["cashflow", "Movimentações", "▤"]] : []),
            ...(canAccess("financing") ? [["financing", "Financiamentos", "▦"]] : []),
            ...(canAccess("calculator") ? [["calculator", "Análises", "⌁"]] : []),
            ...(canAccess("pricing") ? [["pricing", "Formação de preço", "◇"]] : []),
            ...(user.access?.role === "owner" ? [["team", "Empresa e acessos", "♙"]] : []),
            ...(isAdministrator ? [["admin", "Moderação", "◉"]] : []),
            ["support", "Suporte", "?"],
            ...(canAccess("history") ? [["history", "Histórico", "◷"]] : []),
          ].map(([id, label, icon]) => (
            <button
              key={id}
              type="button"
              className={view === id ? "nav-link active" : "nav-link"}
              onClick={() => setView(id)}
              aria-current={view === id ? "page" : undefined}
            >
              <span>{icon}</span>
              {label}
            </button>
          ))}
          <button
            type="button"
            className="nav-link mobile-logout"
            onClick={logout}
            title="Sair da conta"
          >
            <span>↪</span>
            Sair
          </button>
        </nav>
        {["owner", "personal"].includes(user.access?.role) && <a className="sidebar-subscribe" href="/assinar"><span>Não é assinante?</span><strong>Assine agora</strong></a>}
        <div className="sidebar-bottom">
          <span className="avatar">{user.name[0]?.toUpperCase()}</span>
          <div>
            <strong>{user.name}</strong>
            <small>{user.email}</small>
          </div>
          <button title="Sair" className="logout" onClick={logout}>
            ↪
          </button>
        </div>
      </aside>
      <section className="content">
        <header>
          <div>
            <p className="eyebrow">
              {view === "home" ? "PRIORIDADES DA OPERAÇÃO" : view === "workspace" ? "ESPAÇO DE TRABALHO" : "GESTÃO DA EMPRESA"}
            </p>
            <h1>
              {view === "home"
                ? "Hoje"
                : view === "workspace"
                  ? "Workspace"
                : view === "calculator"
                  ? "Análises"
                  : view === "financing"
                    ? "Financiamentos"
                    : view === "pricing"
                      ? "Formação de preço"
                      : view === "cashflow"
                        ? "Movimentações"
                        : view === "inventory"
                          ? "Logística e estoque"
                          : view === "commerce"
                            ? "Pedidos e vendas"
                            : view === "services"
                              ? "Ordens de serviço"
                            : view === "clients"
                              ? "Clientes"
                              : view === "tasks"
                                ? "Tarefas"
                            : view === "admin"
                              ? "Moderação do sistema"
                              : view === "support"
                                ? "Suporte"
                              : view === "team"
                                ? "Empresa e acessos"
                            : "Histórico salvo"}
            </h1>
          </div>
          <div className="header-actions">
            <span className={`save-status ${saveStatus}`} role="status">
              <i />
              {saveStatus === "saving"
                ? "Salvando…"
                : saveStatus === "error"
                  ? "Falha ao salvar"
                  : saveStatus === "loading"
                    ? "Carregando…"
                    : "Salvo na conta"}
            </span>
            <span className="date-tag">
              {new Date().toLocaleDateString("pt-BR", {
                month: "long",
                year: "numeric",
              })}
            </span>
            {canAccess("exports") && view !== "history" && view !== "home" && view !== "workspace" && view !== "team" && view !== "clients" && view !== "tasks" && view !== "services" && (
              <div className="context-export-actions" aria-label="Exportar aba atual">
                <button className="secondary-button compact" onClick={() => setShowExportCenter((current) => !current)}>
                  Exportar seleção
                </button>
                <button className="secondary-button compact" onClick={downloadCurrentCsv}>
                  CSV
                </button>
                <button
                  className="secondary-button compact"
                  onClick={downloadCurrentPdf}
                  disabled={currentPdfLoading}
                >
                  {currentPdfLoading ? "Gerando PDF…" : "PDF"}
                </button>
              </div>
            )}
          </div>
        </header>
        {notice && (
          <div className="notice">
            {notice}
            <button onClick={() => setNotice("")}>×</button>
          </div>
        )}
        {showExportCenter && (
          <section className="panel export-center" aria-label="Selecionar conteúdo da exportação">
            <div><span className="eyebrow">EXPORTAÇÃO PERSONALIZADA</span><h2>O que deseja incluir?</h2><p>Somente as seções marcadas e com dados preenchidos serão incluídas.</p></div>
            <div className="export-checks">
              {[["calculations", "Análises e financiamentos"], ["finance", "Movimentações e caixa"], ["inventory", "Logística e estoque"], ["commerce", "Pedidos e vendas"]].map(([id, label]) => <label key={id}><input type="checkbox" checked={exportSections[id]} onChange={(event) => setExportSections((current) => ({ ...current, [id]: event.target.checked }))} /> {label}</label>)}
            </div>
            <div className="module-actions"><button className="secondary-button" onClick={() => exportSelected("csv")}>Baixar CSV</button><button className="secondary-button" onClick={() => exportSelected("pdf")}>Baixar PDF</button><button className="primary-button" onClick={() => exportSelected("drive")}>Enviar ao Drive</button></div>
          </section>
        )}
        <div className="view-stage" key={view}>
        {view === "home" && <>
          <TodayOperations onOpen={(target) => setView(target)} />
          {canAccess("dashboard") ? <Dashboard
            cashEntries={cashEntries}
            financialAccounts={financialAccounts}
            inventoryState={inventoryState}
            commerceOrders={commerceOrders}
            clients={clients}
            tasks={tasks}
            access={{ finance: canAccess("cashflow"), inventory: canAccess("inventory"), commerce: canAccess("commerce"), clients: canAccess("clients"), tasks: canAccess("tasks") }}
            onOpen={(target) => setView(target)}
            onReset={resetOperationalSections}
          /> : null}
        </>}
        {view === "workspace" && (
          <DocumentHome
            user={user}
            items={history}
            loading={historyLoading}
            onNew={startNewDocument}
            onOpen={loadHistoryItem}
            onRestore={restoreAutomaticDraft}
            onViewAll={() => setView("history")}
            allowedViews={new Set(["calculator", "financing", "pricing", "cashflow", "inventory", "commerce"].filter((area) => canAccess(area)))}
            showHistory={canAccess("history")}
          />
        )}
        {view === "calculator" && (
          <Calculator
            inputs={inputs}
            setInputs={setInputs}
            updateFlow={updateFlow}
            updatePeriods={updatePeriods}
            addFlow={addFlow}
            result={result}
            calculationType={calculationType}
            setCalculationType={setCalculationType}
            saveTitle={saveTitle}
            setSaveTitle={setSaveTitle}
            onSave={saveCalculation}
            onNew={() => {
              if (confirm("Limpar os campos e iniciar um novo cálculo?")) {
                setInputs(emptyInputs());
                setSaveTitle("Simulação financeira");
              }
            }}
          />
        )}
        {view === "financing" && (
          <FinanceTables
            state={financeState}
            setState={setFinanceState}
            onSave={saveFinancialTable}
            onNew={() => setFinanceState(emptyFinanceState())}
            onExportDrive={exportFinancialTableToDrive}
          />
        )}
        {view === "pricing" && (
          <ProductPricing
            state={pricingState}
            setState={setPricingState}
            onSave={savePricing}
          />
        )}
        {view === "cashflow" && (
          <div className="business-stack">
            <FinancialCommitments accounts={financialAccounts} setAccounts={setFinancialAccounts}
              cashEntries={cashEntries}
              categories={financialCategories} onCreateCategory={createFinancialCategory}
              onStatusChange={changeAccountStatus} onPayment={recordAccountPayment} onScanRequest={scanBillImage} />
            <CashFlow organizationName={organizationName} setOrganizationName={setOrganizationName}
              entries={cashEntries} filteredEntries={filteredCashEntries} filters={cashFilters}
              setFilters={setCashFilters} setEntries={setCashEntries} totals={cashTotals} categories={financialCategories}
              categoryRules={financialCategoryRules} setCategoryRules={setFinancialCategoryRules}
              financialAccounts={financialAccounts} commerceOrders={commerceOrders}
              onReconcile={reconcileFinancialSuggestion} onUndoReconciliation={undoFinancialReconciliation}
              onSave={saveCashFlow} />
          </div>
        )}
        {view === "inventory" && <InventoryOperations clients={clients} onDeliveriesChange={(deliveries) => setInventoryState((current) => ({ ...current, deliveries }))} canExport={canAccess("exports")} canUseDrive={canAccess("exports") && canAccess("drive")} canDiscount={canAccess("discounts")} driveStatus={driveStatus} onSnapshot={(snapshot) => setInventoryState((current) => ({ ...current, ...snapshot }))} />}
        {view === "commerce" && <InventoryOperations initialSection="orders" clients={clients} onDeliveriesChange={(deliveries) => setInventoryState((current) => ({ ...current, deliveries }))} canExport={canAccess("exports")} canUseDrive={canAccess("exports") && canAccess("drive")} canDiscount={canAccess("discounts")} driveStatus={driveStatus} onSnapshot={(snapshot) => setInventoryState((current) => ({ ...current, ...snapshot }))} />}
        {view === "services" && <ServiceOperations clients={clients} />}
        {view === "clients" && <ClientManager clients={clients} setClients={setClients} orders={[...commerceOrders, ...(inventoryState.orders || [])]} />}
        {view === "tasks" && <TaskKanban tasks={tasks} setTasks={setTasks} clients={clients} />}
        {view === "admin" && isAdministrator && <AdminOverview overview={adminOverview} monitoringPath={user.monitoringPath} onRefresh={loadAdminOverview} />}
        {view === "support" && <SupportCenter />}
        {view === "team" && user.access?.role === "owner" && <TeamAccess />}
        {view === "history" && (
          <History
            items={history}
            onLoad={loadHistoryItem}
            onRestore={restoreAutomaticDraft}
            onDelete={deleteHistory}
            onRefresh={loadHistory}
            nextCursor={historyNextCursor}
            loading={historyLoading}
            onLoadMore={() => loadHistory(null, { append: true, cursor: historyNextCursor })}
            driveStatus={driveStatus}
            onConnectDrive={connectGoogleDrive}
            onSendToDrive={sendHistoryToDrive}
            onDisconnectDrive={disconnectGoogleDrive}
            driveUpload={driveUpload}
            fileDownload={fileDownload}
            onDownload={downloadHistoryFile}
          />
        )}
        </div>
      </section>
      {fileNameDialogProps && <FileNameDialog {...fileNameDialogProps} />}
    </main>
  );
}

const DOCUMENT_TYPES = {
  VPL: { label: "Análise de investimento", icon: "↗", tone: "violet" },
  TIR: { label: "Análise de investimento", icon: "↗", tone: "violet" },
  Payback: { label: "Análise de investimento", icon: "↗", tone: "violet" },
  "tabela-financeira": { label: "Financiamentos", icon: "▦", tone: "blue" },
  "preco-produto": { label: "Preço do produto", icon: "◇", tone: "orange" },
  "organizacao-financeira": { label: "Movimentações", icon: "◫", tone: "green" },
  "rascunho-automatico": { label: "Rascunho automático", icon: "✎", tone: "gray" },
};

const DOCUMENT_TEMPLATES = [
  { id: "calculator", title: "Análise de investimento", text: "VPL, TIR, ROI e payback", icon: "↗", tone: "violet" },
  { id: "financing", title: "Financiamentos", text: "Compare PRICE, SAF, SAC ou SAA", icon: "▦", tone: "blue" },
  { id: "pricing", title: "Preço do produto", text: "Custos, margem e preço unitário", icon: "◇", tone: "orange" },
  { id: "cashflow", title: "Movimentações", text: "Contas, extratos e fluxo de caixa", icon: "◫", tone: "green" },
  { id: "inventory", title: "Logística e estoque", text: "Produtos, quantidades e entregas", icon: "▣", tone: "blue" },
  { id: "commerce", title: "Pedidos e vendas", text: "Compras, vendas, clientes e fornecedores", icon: "⇄", tone: "orange" },
];

function DocumentHome({ user, items, loading, onNew, onOpen, onRestore, onViewAll, allowedViews, showHistory, overview }) {
  const recentItems = items.slice(0, 6);

  return (
    <div className="document-home">
      <section className="home-welcome">
        <div>
          <span className="eyebrow">OLÁ, {user.name.split(" ")[0].toUpperCase()}</span>
          <h2>O que você quer organizar hoje?</h2>
          <p>Comece um documento novo ou continue trabalhando em um arquivo salvo.</p>
        </div>
        <button
          className="primary-button new-document-button"
          onClick={() => {
            const models = document.getElementById("document-templates");
            models?.scrollIntoView({ behavior: "smooth", block: "center" });
            models?.querySelector("button")?.focus({ preventScroll: true });
          }}
        >
          <span>＋</span> Novo documento
        </button>
      </section>

      {overview && <section className="home-section workspace-overview-section"><div className="home-section-heading"><div><span className="eyebrow">VISÃO GERAL</span><h2>Resumo do seu negócio</h2></div></div>{overview}</section>}

      <section className="home-section" id="document-templates">
        <div className="home-section-heading">
          <div>
            <span className="eyebrow">COMEÇAR</span>
            <h2>Escolha um modelo</h2>
          </div>
        </div>
        <div className="template-grid">
          {DOCUMENT_TEMPLATES.filter((template) => allowedViews?.has(template.id) ?? true).map((template) => (
            <button className="template-card" key={template.id} onClick={() => onNew(template.id)}>
              <span className={`document-icon ${template.tone}`}>{template.icon}</span>
              <span>
                <strong>{template.title}</strong>
                <small>{template.text}</small>
              </span>
              <i>→</i>
            </button>
          ))}
        </div>
      </section>

      {showHistory && <section className="home-section recent-section">
        <div className="home-section-heading">
          <div>
            <span className="eyebrow">SUA CONTA</span>
            <h2>Documentos recentes</h2>
          </div>
          {items.length > 0 && (
            <button className="text-link-button" onClick={onViewAll}>Ver todos →</button>
          )}
        </div>
        {loading ? (
          <div className="home-empty">Carregando seus documentos…</div>
        ) : recentItems.length === 0 ? (
          <div className="home-empty">
            <span>□</span>
            <strong>Seu espaço ainda está vazio</strong>
            <p>Escolha um modelo acima para criar seu primeiro documento.</p>
          </div>
        ) : (
          <div className="document-grid">
            {recentItems.map((item) => {
              const type = DOCUMENT_TYPES[item.calculation_type] || DOCUMENT_TYPES.VPL;
              const isDraft = item.calculation_type === "rascunho-automatico";
              return (
                <button
                  className="document-card"
                  key={item.id}
                  onClick={() => (isDraft ? onRestore(item) : onOpen(item))}
                >
                  <span className={`document-icon ${type.tone}`}>{type.icon}</span>
                  <span className="document-card-copy">
                    <small>{type.label}</small>
                    <strong>{item.title}</strong>
                    <time>Salvo em {formatDate(item.created_at)}</time>
                  </span>
                  <i>•••</i>
                </button>
              );
            })}
          </div>
        )}
      </section>}
    </div>
  );
}

function InventoryOverviewChart({ products }) {
  const rows = products
    .filter((product) => product.lockedAt && (product.name || product.sku || Number(product.quantity)))
    .sort((a, b) => (Number(b.quantity) || 0) - (Number(a.quantity) || 0))
    .slice(0, 8);
  const max = Math.max(...rows.map((product) => Math.max(Number(product.quantity) || 0, Number(product.minimum) || 0)), 1);
  if (!rows.length) return <p className="overview-empty">Cadastre produtos para visualizar o nível do estoque.</p>;
  return <div className="inventory-overview-chart">{rows.map((product, index) => {
    const quantity = Number(product.quantity) || 0;
    const minimum = Number(product.minimum) || 0;
    const tone = quantity <= 0 ? "out" : quantity <= minimum ? "low" : "ok";
    return <div className="inventory-overview-row" key={product.id || `${product.sku}-${index}`}>
      <div><strong>{product.name || product.sku || "Produto"}</strong><small>{quantity} un. · mínimo {minimum}</small></div>
      <span><i className={tone} style={{ width: `${Math.max(quantity > 0 ? 4 : 0, (Math.max(0, quantity) / max) * 100)}%` }} /></span>
    </div>;
  })}</div>;
}

function CommerceOverviewChart({ orders }) {
  const rows = orders.filter((order) => order.status !== "cancelado" && Number(order.amount) > 0);
  if (!rows.length) return <p className="overview-empty">Registre compras e vendas para acompanhar a evolução comercial.</p>;
  let balance = 0;
  const points = rows.map((order, index) => {
    const value = Math.abs(Number(order.amount) || 0) * (order.type === "compra" ? -1 : 1);
    balance += value;
    return { ...order, index, value, balance };
  });
  const max = Math.max(...points.map((point) => Math.abs(point.value)), 1);
  const width = Math.max(560, points.length * 108);
  return <div className="commerce-chart-scroll" aria-label="Evolução de compras e vendas"><div className="commerce-chart" style={{ width }}>
    {points.map((point) => {
      const sale = point.value >= 0;
      const signed = `${sale ? "+" : "-"}${money.format(Math.abs(point.value))}`;
      return <div className="commerce-column" key={point.id || `${point.date}-${point.index}`} tabIndex="0" aria-label={`${sale ? "Venda" : "Compra"} ${signed}; saldo acumulado ${money.format(point.balance)}`}>
        <div className="commerce-track"><span className="commerce-tooltip"><strong>{signed}</strong><small>Saldo: {money.format(point.balance)}</small></span><i className={sale ? "sale" : "purchase"} style={{ height: `${Math.max(8, Math.abs(point.value) / max * 82)}px` }} /></div>
        <strong className={sale ? "positive" : "negative"}>{sale ? "Venda" : "Compra"}</strong><small>{formatDate(point.date)}</small>
      </div>;
    })}
  </div></div>;
}

function Dashboard({ cashEntries, financialAccounts, inventoryState, commerceOrders, clients = [], tasks = [], access, onOpen, onReset, embedded = false }) {
  const [period, setPeriod] = useState("90");
  const [resetSections, setResetSections] = useState({ finance: false, inventory: false, commerce: false });
  const cutoff = period === "all" ? null : new Date(Date.now() - Number(period) * 86_400_000);
  const inPeriod = (date) => !cutoff || !date || new Date(`${date}T12:00:00`) >= cutoff;
  const financeRows = cashEntries.filter((entry) => (entry.description || Number(entry.amount)) && inPeriod(entry.date));
  const allOrders = [...(inventoryState.orders || []), ...commerceOrders]
    .filter((order, index, rows) => (order.partner || Number(order.amount)) && (!order.id || rows.findIndex((candidate) => candidate.id && String(candidate.id) === String(order.id)) === index));
  const orderRows = allOrders.filter((order) => inPeriod(order.date));
  const cash = financeRows.reduce((total, entry) => total + (entry.type === "entrada" ? 1 : -1) * (Number(entry.amount) || 0), 0);
  const pending = financialAccounts.reduce((total, account) => {
    if (!["pendente", "parcial"].includes(account.status) || !inPeriod(account.dueDate)) return total;
    return total + (account.type === "receber" ? 1 : -1) * commitmentAmounts(account).balance;
  }, 0);
  const stockValue = inventoryState.products.reduce((sum, product) => sum + (Number(product.quantity) || 0) * (Number(product.unitCost) || 0), 0);
  const commerce = orderRows.reduce((total, order) => order.status === "cancelado" ? total : total + (order.type === "venda" ? 1 : -1) * (Number(order.amount) || 0), 0);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const monthOrders = allOrders.filter((order) => String(order.date || "").startsWith(currentMonth) && order.status !== "cancelado");
  const monthCash = cashEntries.filter((entry) => String(entry.date || "").startsWith(currentMonth));
  const monthlySales = monthOrders.filter((order) => order.type === "venda").reduce((sum, order) => sum + (Number(order.amount) || 0), 0);
  const monthlyPurchases = monthOrders.filter((order) => order.type === "compra").reduce((sum, order) => sum + (Number(order.amount) || 0), 0);
  const monthlyRevenue = monthCash.filter((entry) => entry.type === "entrada").reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
  const monthlyExpenses = monthCash.filter((entry) => entry.type === "saida").reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
  // Sem custo por item vendido, o lucro bruto é uma visão operacional: vendas menos compras do mês.
  const grossProfit = monthlySales - monthlyPurchases;
  const netProfit = monthlyRevenue - monthlyExpenses;
  const partnerNames = new Set(allOrders.filter((order) => order.type === "venda" && order.partner).map((order) => order.partner.trim().toLocaleLowerCase("pt-BR")));
  const clientCount = new Set([...clients.map((client) => client.name?.trim().toLocaleLowerCase("pt-BR")).filter(Boolean), ...partnerNames]).size;
  const openTasks = tasks.filter((task) => task.status !== "done");
  const overdueTasks = openTasks.filter((task) => task.dueDate && new Date(`${task.dueDate}T23:59:59`) < new Date());
  const flowRows = financeRows
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((entry, index) => ({ period: index + 1, date: entry.date, flow: (entry.type === "entrada" ? 1 : -1) * (Number(entry.amount) || 0) }));
  const allowedReset = Object.entries(resetSections).some(([key, selected]) => selected && access[key]);
  function resetSelected() {
    if (!allowedReset) return;
    if (!confirm("Iniciar um novo ciclo nas áreas marcadas? Os dados atuais dessas áreas serão limpos deste documento. Documentos já salvos no Histórico não serão apagados.")) return;
    onReset(resetSections);
    setResetSections({ finance: false, inventory: false, commerce: false });
  }
  const charts = <section className="overview-chart-grid">
    {access.finance && <article className="panel chart-panel"><div className="panel-heading"><div><span className="eyebrow">MOVIMENTAÇÕES</span><h2>Entradas e saídas realizadas</h2><p>Movimentos cadastrados no caixa dentro do período escolhido.</p></div><button className="secondary-button" onClick={() => onOpen("cashflow")}>Abrir Movimentações</button></div>{flowRows.length ? <CashFlowChart rows={flowRows} /> : <p className="overview-empty">Adicione movimentações para formar o gráfico.</p>}</article>}
    {access.inventory && <article className="panel"><div className="panel-heading"><div><span className="eyebrow">ESTOQUE</span><h2>Quantidade por produto</h2><p>Um gráfico diferente do caixa, com alerta para o nível mínimo.</p></div><button className="secondary-button" onClick={() => onOpen("inventory")}>Abrir Estoque</button></div><InventoryOverviewChart products={inventoryState.products} /></article>}
    {access.commerce && <article className="panel overview-commerce-panel"><div className="panel-heading"><div><span className="eyebrow">VENDAS DO NEGÓCIO</span><h2>Gráfico de vendas e compras</h2><p>Compras ficam negativas em vermelho; cada venda acrescenta valor em verde.</p></div><button className="secondary-button" onClick={() => onOpen("commerce")}>Abrir pedidos</button></div><CommerceOverviewChart orders={orderRows} /></article>}
  </section>;
  const resetControl = <details className="panel reset-operation-panel"><summary>Iniciar um novo ciclo da loja</summary><p>Use apenas quando quiser limpar uma ou mais áreas do documento atual e começar novos gráficos. O histórico salvo permanece disponível.</p><div className="reset-operation-checks">{access.finance && <label><input type="checkbox" checked={resetSections.finance} onChange={(event) => setResetSections((current) => ({ ...current, finance: event.target.checked }))} /> Movimentações</label>}{access.inventory && <label><input type="checkbox" checked={resetSections.inventory} onChange={(event) => setResetSections((current) => ({ ...current, inventory: event.target.checked }))} /> Estoque</label>}{access.commerce && <label><input type="checkbox" checked={resetSections.commerce} onChange={(event) => setResetSections((current) => ({ ...current, commerce: event.target.checked }))} /> Pedidos e vendas</label>}</div><button className="secondary-button danger-button" disabled={!allowedReset} onClick={resetSelected}>Limpar áreas selecionadas</button></details>;
  return (
    <div className={`business-stack operational-dashboard ${embedded ? "workspace-dashboard" : ""}`}>
      <section className={embedded ? "workspace-overview-controls" : "panel overview-toolbar"}><div>{!embedded && <><span className="eyebrow">OPERAÇÃO DA EMPRESA</span><h2>Relatório geral da conta</h2></>}<p>Vendas, caixa, estoque, clientes e prazos reunidos para você decidir o que fazer primeiro.</p></div><label>Período dos gráficos<select value={period} onChange={(event) => setPeriod(event.target.value)}><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option><option value="365">Últimos 12 meses</option><option value="all">Todo o período</option></select></label></section>
      <section className="stats-grid executive-stats">
        {access.commerce && <StatCard label="Vendas do mês" value={money.format(monthlySales)} positive={monthlySales > 0} neutral={monthlySales === 0} caption={`${monthOrders.filter((order) => order.type === "venda").length} pedido(s) de venda`} />}
        {access.finance && <StatCard label="Receita recebida" value={money.format(monthlyRevenue)} positive={monthlyRevenue > 0} neutral={monthlyRevenue === 0} caption="Entradas confirmadas neste mês" />}
        {access.finance && <StatCard label="Caixa realizado" value={`${cash > 0 ? "+" : cash < 0 ? "-" : ""}${money.format(Math.abs(cash))}`} positive={cash > 0} neutral={cash === 0} caption={cash > 0 ? "A operação está com entrada líquida" : cash < 0 ? "As saídas superam as entradas" : "Entradas e saídas estão equilibradas"} />}
        {access.commerce && <StatCard label="Lucro bruto estimado" value={`${grossProfit < 0 ? "-" : ""}${money.format(Math.abs(grossProfit))}`} positive={grossProfit > 0} neutral={grossProfit === 0} caption="Vendas menos compras do mês" />}
        {access.finance && <StatCard label="Lucro líquido operacional" value={`${netProfit < 0 ? "-" : ""}${money.format(Math.abs(netProfit))}`} positive={netProfit > 0} neutral={netProfit === 0} caption="Receitas recebidas menos saídas do mês" />}
        {access.clients && <StatCard label="Clientes" value={clientCount} positive={clientCount > 0} neutral={clientCount === 0} caption="Cadastrados e encontrados nas vendas" />}
        {access.finance && <StatCard label="Contas pendentes" value={`${pending > 0 ? "+" : pending < 0 ? "-" : ""}${money.format(Math.abs(pending))}`} positive={pending > 0} neutral={pending === 0} caption={pending > 0 ? "Há mais valores a receber" : pending < 0 ? "Há mais valores a pagar" : "Sem diferença entre contas pendentes"} />}
        {access.inventory && <StatCard label="Valor em estoque" value={money.format(stockValue)} positive={stockValue >= 0} caption={`${inventoryState.products.filter((item) => item.name || item.sku).length} produtos cadastrados`} />}
        {access.tasks && <StatCard label="Tarefas abertas" value={openTasks.length} positive={overdueTasks.length === 0} neutral={openTasks.length === 0} caption={overdueTasks.length ? `${overdueTasks.length} tarefa(s) atrasada(s)` : "Nenhuma tarefa atrasada"} />}
      </section>
      <section className="panel dashboard-shortcuts"><div><span className="eyebrow">ATALHOS</span><h2>O que precisa de atenção?</h2></div><div>{access.commerce && <button className="secondary-button" onClick={() => onOpen("commerce")}>Novo pedido</button>}{access.inventory && <button className="secondary-button" onClick={() => onOpen("inventory")}>Conferir estoque</button>}{access.finance && <button className="secondary-button" onClick={() => onOpen("cashflow")}>Ver contas</button>}{access.clients && <button className="secondary-button" onClick={() => onOpen("clients")}>Falar com cliente</button>}{access.tasks && <button className="primary-button" onClick={() => onOpen("tasks")}>Abrir tarefas</button>}</div></section>
      {embedded ? <details className="panel workspace-overview-details"><summary>Ver gráficos e controles da operação</summary><div className="workspace-overview-expanded">{charts}{resetControl}</div></details> : <>{charts}{resetControl}</>}
    </div>
  );
}
function Indicator({ label, value, display }) {
  return (
    <div className="indicator">
      <span>{label}</span>
      <strong>{display ?? pct(value)}</strong>
      <div>
        <i style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
    </div>
  );
}
function Calculator({
  inputs,
  setInputs,
  updateFlow,
  updatePeriods,
  addFlow,
  result,
  calculationType,
  setCalculationType,
  saveTitle,
  setSaveTitle,
  onSave,
  onNew,
}) {
  return (
    <>
      <section className="calculator-toolbar">
        <div className="calculation-tabs">
          {["VPL", "TIR", "Payback"].map((type) => (
            <button
              className={calculationType === type ? "active" : ""}
              key={type}
              onClick={() => setCalculationType(type)}
            >
              {type}
            </button>
          ))}
        </div>
        <div className="save-actions">
          <input
            aria-label="Nome do cálculo"
            value={saveTitle}
            onChange={(e) => setSaveTitle(e.target.value)}
          />
          <button className="primary-button compact" onClick={onSave}>
            Salvar no histórico
          </button>
          <button className="secondary-button compact" onClick={onNew}>
            Limpar cálculo
          </button>
        </div>
      </section>
      <section className="calculator-grid">
        <article className="panel input-panel">
          <span className="eyebrow">ENTRADAS</span>
          <h2>Premissas do cálculo</h2>
          <div className="field-grid">
            <label>
              Investimento inicial
              <input
                type="number"
                min="0"
                placeholder="0,00"
                value={inputs.investment}
                onChange={(e) =>
                  setInputs({ ...inputs, investment: e.target.value })
                }
              />
            </label>
            <label>
              Data do investimento
              <input
                type="date"
                value={inputs.investmentDate}
                onChange={(e) =>
                  setInputs({ ...inputs, investmentDate: e.target.value })
                }
              />
            </label>
            <label>
              Taxa mensal (%)
              <input
                type="number"
                step="0.01"
                placeholder="0,00"
                value={inputs.rate}
                onChange={(e) => setInputs({ ...inputs, rate: e.target.value })}
              />
            </label>
            <label>
              Quantidade de períodos
              <input
                type="number"
                min="1"
                max="120"
                placeholder="0"
                value={inputs.periods}
                onChange={(e) => updatePeriods(e.target.value)}
              />
            </label>
          </div>
          <p className="field-note">
            VPL e TIR usam períodos mensais igualmente espaçados. As datas
            identificam os fluxos e estimam a data do payback.
          </p>
          <div className="cash-inputs">
            <div className="panel-heading">
              <h3>Fluxo de caixa projetado</h3>
              <button className="secondary-button" onClick={addFlow}>
                + Período
              </button>
            </div>
            {inputs.flows.map((flow, index) => (
              <label className="flow-input" key={index}>
                <span>Período {index + 1}</span>
                <input
                  aria-label={`Data do período ${index + 1}`}
                  type="date"
                  value={flow.date}
                  onChange={(e) => updateFlow(index, "date", e.target.value)}
                />
                <input
                  aria-label={`Valor do período ${index + 1}`}
                  type="number"
                  placeholder="0,00"
                  value={flow.amount}
                  onChange={(e) => updateFlow(index, "amount", e.target.value)}
                />
              </label>
            ))}
          </div>
        </article>
        <article className="panel result-panel">
          <span className="eyebrow">RESULTADOS</span>
          <h2>{calculationType} e indicadores</h2>
          <div className="result-emphasis">
            <span>
              {calculationType === "TIR"
                ? "Taxa interna de retorno"
                : calculationType === "Payback"
                  ? "Tempo estimado de retorno"
                  : "Valor presente líquido"}
            </span>
            <strong>
              {calculationType === "TIR"
                ? pct(result.irr)
                : calculationType === "Payback"
                  ? result.paybackDuration || "Não recuperado"
                  : money.format(result.npv)}
            </strong>
            {calculationType === "Payback" && result.paybackDate ? (
              <small>Data estimada: {formatDate(result.paybackDate)}</small>
            ) : null}
          </div>
          <div className="mini-stats">
            <span>
              ROI<strong>{pct(result.roi)}</strong>
            </span>
            <span>
              Índice de lucratividade
              <strong>
                {Number.isFinite(result.profitabilityIndex)
                  ? `${result.profitabilityIndex.toFixed(3)}×`
                  : "N/D"}
              </strong>
            </span>
          </div>
          <h3>Fluxo de caixa</h3>
          <CashFlowChart rows={result.table} />
          <h3>Tabela de cálculo</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Período</th>
                  <th>Data</th>
                  <th>Fluxo</th>
                  <th>Valor presente</th>
                  <th>Acumulado</th>
                </tr>
              </thead>
              <tbody>
                {result.table.map((row) => (
                  <tr key={row.period}>
                    <td>{row.period}</td>
                    <td>{formatDate(row.date)}</td>
                    <td className={row.flow >= 0 ? "positive" : "negative"}>
                      {signedMoney(row.flow, row.flow >= 0 ? "entrada" : "saida")}
                    </td>
                    <td>{money.format(row.discounted)}</td>
                    <td>{money.format(row.accumulated)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </>
  );
}
function CashFlow({
  organizationName,
  setOrganizationName,
  entries,
  filteredEntries,
  filters,
  setFilters,
  setEntries,
  totals,
  categories,
  categoryRules,
  setCategoryRules,
  financialAccounts,
  commerceOrders,
  onReconcile,
  onUndoReconciliation,
  onSave,
}) {
  const [pdfState, setPdfState] = useState({ loading: false, message: "" });
  const [fileImport, setFileImport] = useState({ loading: false, message: "", preview: null, filename: "" });
  const [ruleDraft, setRuleDraft] = useState({ term: "", category: categories?.[0] || "Geral", type: "todos" });
  const markedPreview = useMemo(
    () => fileImport.preview ? markFinancialDuplicates(fileImport.preview.rows, entries) : null,
    [fileImport.preview, entries],
  );
  const latestImportBatch = useMemo(() => {
    const batches = new Map();
    entries.forEach((entry) => {
      if (!entry.importBatchId) return;
      const current = batches.get(entry.importBatchId) || { id: entry.importBatchId, importedAt: entry.importedAt || "", count: 0 };
      current.count += 1;
      if (String(entry.importedAt || "") > current.importedAt) current.importedAt = entry.importedAt;
      batches.set(entry.importBatchId, current);
    });
    return [...batches.values()].sort((a, b) => b.importedAt.localeCompare(a.importedAt))[0] || null;
  }, [entries]);
  const reconciliationSuggestions = useMemo(
    () => suggestFinancialReconciliations(entries, financialAccounts, commerceOrders),
    [entries, financialAccounts, commerceOrders],
  );
  const categorySuggestions = useMemo(() => entries.map((entry, index) => ({ index, suggestion: suggestCategory(entry, categoryRules) }))
    .filter(({ suggestion, index }) => suggestion && suggestion.category !== entries[index]?.category), [entries, categoryRules]);
  const availableCategories = [...new Set([
    ...(categories || []),
    ...entries.map((entry) => entry.category),
  ].map((category) => String(category || "").trim()).filter(Boolean))];
  function edit(index, field, value) {
    setEntries((current) => {
      const copy = [...current];
      copy[index] = { ...copy[index], id: copy[index].id || newWorkspaceEntityId("entry"), [field]: value };
      return copy;
    });
  }
  function addEntry() {
    // Remove filtros para garantir que o lançamento recém-criado fique visível.
    setFilters({ month: "", type: "todos", category: "todos" });
    setEntries((current) => [...current, { ...blankCashRow(), id: newWorkspaceEntityId("entry") }]);
  }
  function removeEntry(index) {
    const entry = entries[index];
    if (entry?.sourceCommitmentId || entry?.sourceOrderKey) {
      alert("Desvincule este lançamento da conta ou do pedido antes de excluí-lo.");
      return;
    }
    const label = entry?.description || entry?.category || "este lançamento";
    if (!confirm(`Excluir ${label}? Esta ação remove somente esta linha.`)) return;
    // Mantém uma linha vazia quando a última movimentação é excluída.
    setEntries((current) => {
      const remaining = current.filter((_, position) => position !== index);
      return remaining.length ? remaining : [blankCashRow()];
    });
  }
  function clearOrganization() {
    if (
      !confirm(
        "Limpar a organização atual? O extrato, os lançamentos e os gráficos atuais serão removidos. Registros já salvos no Histórico não serão apagados.",
      )
    ) return;
    // O autosave do workspace persistirá este estado limpo na conta do usuário.
    setEntries([blankCashRow()]);
    setFilters({ month: "", type: "todos", category: "todos" });
    setOrganizationName("Minha organização");
    setPdfState({ loading: false, message: "Organização atual limpa." });
  }
  async function importPdf(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (
      file.type !== "application/pdf" &&
      !file.name.toLowerCase().endsWith(".pdf")
    ) {
      setPdfState({
        loading: false,
        message: "Selecione um arquivo PDF válido.",
      });
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setPdfState({
        loading: false,
        message: "O PDF deve ter no máximo 15 MB.",
      });
      return;
    }
    setPdfState({
      loading: true,
      message: "Lendo o extrato no seu navegador…",
    });
    try {
      const imported = await parseBankStatementPdf(file);
      if (imported.length === 0) {
        setPdfState({
          loading: false,
          message:
            "Nenhum lançamento foi reconhecido. O PDF pode ser uma imagem digitalizada ou usar um formato de extrato ainda não identificado.",
        });
        return;
      }
      // Substitui a linha inicial vazia e mantém lançamentos que a pessoa já digitou.
      setEntries((current) => {
        const existing = current.filter(
          (entry) => entry.description || Number(entry.amount) > 0,
        );
        return [...existing, ...imported.map((entry) => ({ ...entry, id: entry.id || newWorkspaceEntityId("entry") }))].sort((a, b) =>
          String(a.date).localeCompare(String(b.date)),
        );
      });
      setFilters({ month: "", type: "todos", category: "todos" });
      setPdfState({
        loading: false,
        message: `${imported.length} lançamento(s) importado(s). Agora revise e classifique cada um.`,
      });
    } catch {
      setPdfState({
        loading: false,
        message:
          "Não foi possível ler o extrato. O PDF pode estar protegido por senha, corrompido ou ser apenas uma imagem.",
      });
    }
  }
  function addCategoryRule(event) {
    event.preventDefault();
    const term = ruleDraft.term.trim();
    if (!term || !ruleDraft.category) return;
    setCategoryRules((current) => [...current, {
      id: newWorkspaceEntityId("category-rule"), version: 1, term,
      category: ruleDraft.category, type: ruleDraft.type, active: true,
    }]);
    setRuleDraft((current) => ({ ...current, term: "" }));
  }
  function applyCategorySuggestion(index, suggestion) {
    edit(index, "category", suggestion.category);
    setEntries((current) => current.map((entry, position) => position === index ? {
      ...entry, categoryRuleId: suggestion.ruleId, categoryRuleVersion: suggestion.ruleVersion,
    } : entry));
  }
  async function previewFinancialImport(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setFileImport({ loading: true, message: "Lendo o arquivo no seu navegador…", preview: null, filename: file.name });
    try {
      const preview = await parseFinancialFile(file);
      setFileImport({ loading: false, message: "", preview, filename: file.name });
    } catch (error) {
      setFileImport({ loading: false, message: error?.message || "Não foi possível ler o arquivo.", preview: null, filename: file.name });
    }
  }
  function confirmFinancialImport() {
    if (!markedPreview?.accepted.length) {
      setFileImport((current) => ({ ...current, message: "Todos os lançamentos desta prévia já foram importados." }));
      return;
    }
    const importedAt = new Date().toISOString();
    const batchId = `import-${Date.now()}-${newWorkspaceEntityId("batch")}`;
    const imported = markedPreview.accepted.map((entry) => ({
      ...entry,
      id: newWorkspaceEntityId("entry"),
      importBatchId: batchId,
      importedAt,
    }));
    setEntries((current) => {
      const existing = current.filter((entry) => entry.description || Number(entry.amount) > 0);
      return [...existing, ...imported].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    });
    setFilters({ month: "", type: "todos", category: "todos" });
    setFileImport({ loading: false, preview: null, filename: "", message: `${imported.length} lançamento(s) importado(s); ${markedPreview.duplicateCount} duplicado(s) ignorado(s).` });
  }
  function undoImportBatch(batch) {
    if (!batch || !confirm(`Desfazer os ${batch.count} lançamentos da última importação?`)) return;
    setEntries((current) => {
      const remaining = current.filter((entry) => entry.importBatchId !== batch.id);
      return remaining.length ? remaining : [blankCashRow()];
    });
    setFileImport({ loading: false, preview: null, filename: "", message: `${batch.count} lançamento(s) da importação foram removidos.` });
  }
  let runningBalance = 0;
  // O saldo de cada linha é derivado dos valores digitados e se atualiza a cada render.
  const rowsWithBalance = filteredEntries.map((entry) => {
    const amount = Number(entry.amount) || 0;
    runningBalance += entry.type === "entrada" ? amount : -amount;
    return { ...entry, runningBalance };
  });
  const organizationChartRows = rowsWithBalance.map((entry, index) => ({
    period: index + 1,
    date: entry.date,
    flow:
      entry.type === "entrada"
        ? Number(entry.amount || 0)
        : -Number(entry.amount || 0),
  }));
  return (
    <>
      <section className="stats-grid three">
        <StatCard
          label="Entradas"
          value={signedMoney(totals.income, "entrada")}
          caption="No período selecionado"
        />
        <StatCard
          label="Saídas"
          value={signedMoney(totals.expense, "saida")}
          positive={false}
          caption="No período selecionado"
        />
        <StatCard
          label="Saldo"
          value={money.format(totals.income - totals.expense)}
          positive={totals.income >= totals.expense}
          caption="Resultado do período"
        />
      </section>
      <article className="panel cash-table">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">ORGANIZAÇÃO FINANCEIRA</span>
            <h2>Organizador de custos</h2>
            <p>
              Importe um extrato, revise os lançamentos e classifique os gastos.
            </p>
          </div>
          <div className="save-actions">
            <label className="secondary-button file-button">
              {fileImport.loading ? "Lendo arquivo…" : "Importar CSV/OFX/XLSX"}
              <input
                type="file"
                accept=".csv,.tsv,.txt,.ofx,.qfx,.xlsx"
                disabled={fileImport.loading}
                onChange={previewFinancialImport}
              />
            </label>
            <label className="secondary-button file-button">
              {pdfState.loading ? "Lendo PDF…" : "Importar extrato PDF"}
              <input
                type="file"
                accept="application/pdf,.pdf"
                disabled={pdfState.loading}
                onChange={importPdf}
              />
            </label>
            <button className="secondary-button" onClick={addEntry}>
              + Lançamento
            </button>
            <button className="danger-button" onClick={clearOrganization}>
              Limpar organização
            </button>
            {latestImportBatch ? (
              <button className="danger-button" onClick={() => undoImportBatch(latestImportBatch)}>
                Desfazer última importação
              </button>
            ) : null}
            <button className="primary-button compact" onClick={onSave}>
              Salvar organização
            </button>
          </div>
        </div>
        <div className="organization-name">
          <label>
            Nome da organização
            <input
              value={organizationName}
              onChange={(event) => setOrganizationName(event.target.value)}
              placeholder="Ex.: Custos de julho"
            />
          </label>
          <small>
            PDF, CSV, OFX e XLSX são processados localmente no navegador e não são enviados ao servidor.
          </small>
        </div>
        {fileImport.preview && markedPreview ? (
          <section className="financial-import-preview" aria-label="Prévia da importação financeira">
            <div className="financial-import-summary">
              <div>
                <span className="eyebrow">PRÉVIA — {fileImport.filename}</span>
                <h3>{markedPreview.accepted.length} novos, {markedPreview.duplicateCount} duplicados</h3>
                <p>Nada será salvo antes da confirmação. Linhas inválidas permanecem fora do lote.</p>
              </div>
              <div className="module-actions">
                <button className="secondary-button" onClick={() => setFileImport({ loading: false, message: "", preview: null, filename: "" })}>Cancelar</button>
                <button className="primary-button compact" disabled={!markedPreview.accepted.length} onClick={confirmFinancialImport}>
                  Importar {markedPreview.accepted.length}
                </button>
              </div>
            </div>
            {(fileImport.preview.warnings.length || fileImport.preview.errors.length) ? (
              <p className="import-status">
                {[...fileImport.preview.warnings, ...fileImport.preview.errors.slice(0, 3)].join(" ")}
                {fileImport.preview.errors.length > 3 ? ` Mais ${fileImport.preview.errors.length - 3} linha(s) inválida(s).` : ""}
              </p>
            ) : null}
            <div className="table-scroll">
              <table>
                <thead><tr><th>Data</th><th>Descrição</th><th>Tipo</th><th>Valor</th><th>Situação</th></tr></thead>
                <tbody>
                  {markedPreview.rows.slice(0, 12).map((entry, index) => (
                    <tr key={`${entry.fingerprint}-${index}`}>
                      <td>{formatDate(entry.date)}</td><td>{entry.description}</td><td>{entry.type === "entrada" ? "Entrada" : "Saída"}</td>
                      <td>{signedMoney(entry.amount, entry.type)}</td><td><span className={`import-badge ${entry.duplicate ? "duplicate" : "new"}`}>{entry.duplicate ? "Duplicado" : "Novo"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {markedPreview.rows.length > 12 ? <small>Mostrando 12 de {markedPreview.rows.length} linhas.</small> : null}
          </section>
        ) : null}
        {fileImport.message ? (
          <p className={fileImport.message.includes("importado") || fileImport.message.includes("removidos") ? "import-status success" : "import-status"}>{fileImport.message}</p>
        ) : null}
        <section className="category-rules-panel" aria-label="Regras de categorização">
          <div>
            <span className="eyebrow">CATEGORIZAÇÃO EXPLICÁVEL</span>
            <h3>Regras da empresa</h3>
            <p>Crie uma regra por palavra da descrição. A sugestão só altera o lançamento depois da sua revisão.</p>
          </div>
          <form className="category-rule-form" onSubmit={addCategoryRule}>
            <label>Descrição contém<input value={ruleDraft.term} maxLength={80} placeholder="Ex.: energia" onChange={(event) => setRuleDraft({ ...ruleDraft, term: event.target.value })} /></label>
            <label>Tipo<select value={ruleDraft.type} onChange={(event) => setRuleDraft({ ...ruleDraft, type: event.target.value })}><option value="todos">Qualquer</option><option value="entrada">Entrada</option><option value="saida">Saída</option></select></label>
            <label>Categoria<select value={ruleDraft.category} onChange={(event) => setRuleDraft({ ...ruleDraft, category: event.target.value })}>{availableCategories.map((category) => <option key={category}>{category}</option>)}</select></label>
            <button className="secondary-button" type="submit">Criar regra</button>
          </form>
          {(categoryRules || []).length ? <div className="category-rule-list">{categoryRules.map((rule, index) => (
            <article key={rule.id}><div><strong>{rule.term}</strong><small>v{rule.version} · {rule.type === "todos" ? "qualquer tipo" : rule.type} → {rule.category}</small></div><button className="danger-button" type="button" onClick={() => setCategoryRules((current) => current.filter((_, position) => position !== index))}>Excluir</button></article>
          ))}</div> : <small>Nenhuma regra criada ainda.</small>}
          {categorySuggestions.length ? <div className="category-rule-list suggestions"><strong>{categorySuggestions.length} sugestão(ões) para revisar</strong>{categorySuggestions.slice(0, 8).map(({ index, suggestion }) => (
            <article key={`${suggestion.ruleId}-${index}`}><div><strong>{entries[index].description || "Sem descrição"} → {suggestion.category}</strong><small>{suggestion.explanation} Regra v{suggestion.ruleVersion}.</small></div><button className="primary-button compact" type="button" onClick={() => applyCategorySuggestion(index, suggestion)}>Aplicar</button></article>
          ))}</div> : null}
        </section>
        {reconciliationSuggestions.length ? (
          <section className="reconciliation-panel" aria-label="Sugestões de conciliação">
            <div>
              <span className="eyebrow">CONCILIAÇÃO ASSISTIDA</span>
              <h3>{reconciliationSuggestions.length} vínculo(s) para revisar</h3>
              <p>O sistema compara direção e valor exato. Nenhuma conta ou pedido recebe baixa sem sua confirmação.</p>
            </div>
            <div className="reconciliation-list">
              {reconciliationSuggestions.slice(0, 8).map((suggestion) => (
                <article key={`${suggestion.entryIndex}-${suggestion.targetType}-${suggestion.targetIndex}`}>
                  <div><strong>{suggestion.entryLabel}</strong><span>↔ {suggestion.targetLabel}</span><small>{suggestion.reason} · confiança: {suggestion.confidence}</small></div>
                  <div><strong>{money.format(suggestion.amount)}</strong><button className="primary-button compact" onClick={() => onReconcile?.(suggestion)}>Revisar e conciliar</button></div>
                </article>
              ))}
            </div>
          </section>
        ) : null}
        {pdfState.message ? (
          <p
            className={
              pdfState.message.includes("importado")
                ? "import-status success"
                : "import-status"
            }
          >
            {pdfState.message}
          </p>
        ) : null}
        <div className="filters">
          <label>
            Período
            <input
              type="month"
              value={filters.month}
              onChange={(e) =>
                setFilters({ ...filters, month: e.target.value })
              }
            />
          </label>
          <label>
            Tipo
            <select
              value={filters.type}
              onChange={(e) => setFilters({ ...filters, type: e.target.value })}
            >
              <option value="todos">Todos os tipos</option>
              <option value="entrada">Entrada</option>
              <option value="saida">Saída</option>
            </select>
          </label>
          <label>
            Categoria
            <select
              value={filters.category}
              onChange={(e) =>
                setFilters({ ...filters, category: e.target.value })
              }
            >
              <option value="todos">Todas as categorias</option>
              {availableCategories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
        </div>
        <section className="organization-visuals">
          <ExpensePieChart entries={filteredEntries} />
          <article className="panel movement-panel">
            <span className="eyebrow">MOVIMENTAÇÕES</span>
            <h2>Linha de entradas e saídas</h2>
            {organizationChartRows.length ? (
              <CashFlowChart rows={organizationChartRows} />
            ) : (
              <p className="empty-chart">
                Adicione lançamentos para formar o gráfico.
              </p>
            )}
          </article>
        </section>
        <CashBalanceChart rows={rowsWithBalance} />
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Categoria</th>
                <th>Descrição</th>
                <th>Tipo</th>
                <th>Valor</th>
                <th>Saldo acumulado</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {rowsWithBalance.map((entry) => (
                <tr key={entry.originalIndex}>
                  <td>
                    <input
                      type="date"
                      value={entry.date}
                      onChange={(e) =>
                        edit(entry.originalIndex, "date", e.target.value)
                      }
                    />
                  </td>
                  <td>
                    <select
                      value={entry.category || "Geral"}
                      onChange={(e) =>
                        edit(entry.originalIndex, "category", e.target.value)
                      }
                    >{availableCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select>
                  </td>
                  <td>
                    <input
                      value={entry.description}
                      onChange={(e) =>
                        edit(entry.originalIndex, "description", e.target.value)
                      }
                    />
                  </td>
                  <td>
                    <select
                      value={entry.type}
                      onChange={(e) =>
                        edit(entry.originalIndex, "type", e.target.value)
                      }
                    >
                      <option value="entrada">Entrada</option>
                      <option value="saida">Saída</option>
                    </select>
                  </td>
                  <td>
                    <div className={`signed-amount-field ${entry.type === "entrada" ? "income" : "expense"}`}>
                      <span>{entry.type === "entrada" ? "+" : "-"}</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0,00"
                        value={Math.abs(Number(entry.amount)) || ""}
                        onChange={(e) => edit(entry.originalIndex, "amount", e.target.value)}
                      />
                    </div>
                  </td>
                  <td
                    className={
                      entry.runningBalance >= 0 ? "positive" : "negative"
                    }
                  >
                    {money.format(entry.runningBalance)}
                  </td>
                  <td>
                    {(entry.sourceCommitmentId || entry.sourceOrderKey) ? (
                      <button
                        type="button"
                        className="secondary-button compact"
                        onClick={() => onUndoReconciliation?.(entry.originalIndex)}
                      >
                        Desvincular
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="danger-button compact"
                      onClick={() => removeEntry(entry.originalIndex)}
                      aria-label={`Excluir lançamento ${entry.description || entry.originalIndex + 1}`}
                    >
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </>
  );
}
function ExportOptions({ item, fileDownload, onDownload }) {
  const loading = fileDownload.id === item.id ? fileDownload.format : null;
  return (
    <details className="export-options">
      <summary className="secondary-button">Outros formatos</summary>
      <div className="export-options-menu">
        <button type="button" onClick={() => onDownload(item, "xlsx")} disabled={Boolean(loading)}>
          <strong>Baixar Excel (.xlsx)</strong>
          <small>{loading === "xlsx" ? "Gerando…" : "Planilha formatada recomendada"}</small>
        </button>
        <button type="button" onClick={() => onDownload(item, "csv")} disabled={Boolean(loading)}>
          <strong>Baixar CSV</strong>
          <small>{loading === "csv" ? "Gerando…" : "Formato simples e compatível"}</small>
        </button>
      </div>
    </details>
  );
}

function History({
  items,
  onLoad,
  onRestore,
  onDelete,
  onRefresh,
  nextCursor,
  loading,
  onLoadMore,
  driveStatus,
  onConnectDrive,
  onSendToDrive,
  onDisconnectDrive,
  driveUpload,
  fileDownload,
  onDownload,
}) {
  return (
    <article className="panel history-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">ARQUIVO DA CONTA</span>
          <h2>Histórico de cálculos e fluxos</h2>
        </div>
        <div className="history-heading-actions">
          {driveStatus.connected && (
            <button className="secondary-button" onClick={onDisconnectDrive}>
              Drive conectado · Desconectar
            </button>
          )}
          <button className="secondary-button" onClick={() => onRefresh()}>
            ↻ Atualizar
          </button>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="empty-state">
          Nenhum registro salvo. Faça um cálculo ou crie um fluxo de caixa para
          começar.
        </div>
      ) : (
        <>
          <div className="history-list">
            {items.map((item) => (
            <article className="history-item" key={item.id}>
              <div>
                <span className="type-badge">{item.calculation_type}</span>
                {item.payload.financialTable && (
                  <span className="type-badge attached-table">
                    + tabela {item.payload.financialTable.state?.system}
                  </span>
                )}
                <h3>{item.title}</h3>
                <small>Salvo em {formatDate(item.created_at)}</small>
              </div>
              <div className="history-actions">
                {item.calculation_type === "rascunho-automatico" && (
                  <button
                    className="secondary-button"
                    onClick={() => onRestore(item)}
                  >
                    Restaurar rascunho
                  </button>
                )}
                {item.calculation_type !== "rascunho-automatico" && (
                  <button
                    className="secondary-button"
                    onClick={() => onLoad(item)}
                  >
                    Abrir
                  </button>
                )}
                <ExportOptions
                  item={item}
                  fileDownload={fileDownload}
                  onDownload={onDownload}
                />
                <button
                  type="button"
                  className="secondary-button"
                  disabled={fileDownload.id === item.id}
                  onClick={() => onDownload(item, "pdf")}
                >
                  {fileDownload.id === item.id && fileDownload.format === "pdf"
                    ? "Gerando PDF…"
                    : "Baixar PDF"}
                </button>
                <button
                  type="button"
                  className="secondary-button drive-action"
                  disabled={
                    driveStatus.loading ||
                    !driveStatus.configured ||
                    (driveUpload.id === item.id && driveUpload.status === "sending")
                  }
                  onClick={() =>
                    driveStatus.connected ? onSendToDrive(item) : onConnectDrive(item)
                  }
                >
                  {driveUpload.id === item.id && driveUpload.status === "sending"
                    ? "Enviando ao Drive…"
                    : driveUpload.id === item.id && driveUpload.status === "sent"
                      ? "Enviado ao Drive ✓"
                      : driveStatus.connected
                        ? "Enviar ao Google Drive"
                        : "Conectar Drive e enviar"}
                </button>
                {driveUpload.id === item.id && driveUpload.file?.webViewLink ? (
                  <a
                    className="secondary-button drive-open-link"
                    href={driveUpload.file.webViewLink}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Abrir no Drive
                  </a>
                ) : null}
                <button
                  className="danger-button"
                  onClick={() => onDelete(item.id)}
                >
                  Excluir
                </button>
              </div>
            </article>
            ))}
          </div>
          {nextCursor && (
            <button type="button" className="secondary-button" disabled={loading} onClick={onLoadMore}>
              {loading ? "Carregando…" : "Carregar mais registros"}
            </button>
          )}
        </>
      )}
    </article>
  );
}
