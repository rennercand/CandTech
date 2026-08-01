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
import {
  FinancialCommitments,
  AdminOverview,
  InventoryLogistics,
  SalesPurchases,
  emptyCommerceOrder,
  emptyFinancialAccount,
  emptyInventoryState,
} from "./business-tools";

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const pct = (number) =>
  Number.isFinite(number) ? `${number.toFixed(2)}%` : "N/D";
const formatDate = (value) => {
  if (!value) return "Sem data";
  // Evita que datas no formato AAAA-MM-DD mudem um dia por causa do fuso horário.
  const simpleDate = String(value).slice(0, 10).split("-");
  return simpleDate.length === 3
    ? `${simpleDate[2]}/${simpleDate[1]}/${simpleDate[0]}`
    : new Date(value).toLocaleDateString("pt-BR");
};
const today = () => new Date().toISOString().slice(0, 10);

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
  date: new Date().toISOString().slice(0, 10),
  category: "Geral",
  description: "",
  type: "entrada",
  amount: "",
});

const emptyInputs = () => ({
  investment: "",
  investmentDate: today(),
  rate: "",
  periods: "",
  flows: [],
});

const emptyFinanceState = () => ({
  system: "PRICE",
  form: { principal: "", rate: "", periods: "", startDate: today() },
});

const emptyPricingState = () => ({
  expenses: [{ name: "", amount: "" }],
  units: "",
  margin: "",
});

function normalizeWorkspacePayload(payload = {}) {
  // Aplica valores seguros para rascunhos antigos ou parcialmente preenchidos.
  const defaults = {
    inputs: emptyInputs(),
    calculationType: "VPL",
    cashEntries: [blankCashRow()],
    cashFilters: { month: "", type: "todos", category: "todos" },
    organizationName: "Minha organização",
    saveTitle: "Simulação financeira",
    financeState: emptyFinanceState(),
    pricingState: emptyPricingState(),
    financialAccounts: [emptyFinancialAccount()],
    inventoryState: emptyInventoryState(),
    commerceOrders: [emptyCommerceOrder()],
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
        ? payload.inventoryState.products
        : defaults.inventoryState.products,
      deliveries: Array.isArray(payload.inventoryState?.deliveries)
        ? payload.inventoryState.deliveries
        : defaults.inventoryState.deliveries,
    },
    commerceOrders: Array.isArray(payload.commerceOrders)
      ? payload.commerceOrders
      : defaults.commerceOrders,
  };
}

function StatCard({ label, value, positive = true, caption }) {
  return (
    <article className="stat-card">
      <span>{label}</span>
      <strong className={positive ? "positive" : "negative"}>{value}</strong>
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
        {rows.map((row) => {
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
                  style={{ height: `${height}px` }}
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

function AuthScreen({ onAuthenticated }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const response = await fetch(
      `/api/auth/${mode === "login" ? "login" : "register"}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      },
    );
    const data = await response.json();
    setLoading(false);
    if (!response.ok)
      return setError(data.error || "Não foi possível continuar.");
    onAuthenticated(data.user);
  }
  return (
    <main className="auth-layout">
      <section className="auth-aside">
        <div className="brand">
          <i>CT</i> CandTech
        </div>
        <div className="auth-message">
          <span className="auth-badge">FINANÇAS CLARAS, DECISÕES MELHORES</span>
          <h1>Seu espaço financeiro, organizado do seu jeito.</h1>
        </div>
        <p>
          Crie análises, acompanhe números e encontre seus documentos sempre
          que precisar — tudo em uma única conta.
        </p>
        <div className="auth-points">
          <span><i>01</i><b>Documentos organizados</b><small>Histórico privado e salvamento automático.</small></span>
          <span><i>02</i><b>Análises confiáveis</b><small>Cálculos auditados e memória detalhada.</small></span>
          <span><i>03</i><b>Exporte como preferir</b><small>Excel, CSV, PDF ou Google Drive.</small></span>
        </div>
        <small className="auth-footnote">Seus dados pertencem à sua conta.</small>
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
        <div className="auth-mobile-brand brand"><i>CT</i> CandTech</div>
        <p className="eyebrow">{mode === "login" ? "BEM-VINDO DE VOLTA" : "COMECE AGORA"}</p>
        <h2>{mode === "login" ? "Entre no seu espaço" : "Crie seu espaço financeiro"}</h2>
        <p className="auth-subtitle">
          {mode === "login"
            ? "Continue de onde parou e acesse seus documentos."
            : "Organize suas decisões financeiras em poucos minutos."}
        </p>
        <form onSubmit={submit}>
          {mode === "register" && (
            <label>
              Nome
              <input
                required
                minLength="2"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
          )}
          <label>
            E-mail
            <input
              required
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
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
          {error && <p className="form-error">{error}</p>}
          <button className="primary-button" disabled={loading}>
            {loading
              ? "Aguarde..."
              : mode === "login"
                ? "Entrar"
                : "Criar conta"}
          </button>
        </form>
        <button
          className="text-button"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError("");
          }}
        >
          {mode === "login"
            ? "Ainda não possui conta? Criar agora"
            : "Já possui conta? Entrar"}
        </button>
      </section>
    </main>
  );
}

export default function Page() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [workspaceReady, setWorkspaceReady] = useState(false);
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
  const [organizationName, setOrganizationName] = useState("Minha organização");
  const [history, setHistory] = useState([]);
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
  const [adminOverview, setAdminOverview] = useState(null);
  const [isAdministrator, setIsAdministrator] = useState(false);
  const [showExportCenter, setShowExportCenter] = useState(false);
  const [exportSections, setExportSections] = useState({ calculations: true, finance: true, inventory: true, commerce: true });
  const lastSavedWorkspace = useRef("");
  const autoSaveTimer = useRef(null);
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
      organizationName,
      saveTitle,
      financeState,
      pricingState,
      financialAccounts,
      inventoryState,
      commerceOrders,
    }),
    [
      inputs,
      calculationType,
      cashEntries,
      cashFilters,
      organizationName,
      saveTitle,
      financeState,
      pricingState,
      financialAccounts,
      inventoryState,
      commerceOrders,
    ],
  );
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.user) setUser(data.user);
      })
      .finally(() => setChecking(false));
  }, []);

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
    const pendingHistoryId = Number(params.get("export"));
    if (driveResult === "connected" && Number.isInteger(pendingHistoryId) && pendingHistoryId > 0) {
      // Continua automaticamente o envio iniciado antes da autorização do Google.
      sendHistoryToDrive({ id: pendingHistoryId });
    } else {
      setNotice(messages[driveResult] || "O Google Drive respondeu à solicitação.");
    }
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  useEffect(() => {
    if (!user) {
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
  }, [user?.id]);

  async function loadAdminOverview() {
    const response = await fetch("/api/admin/overview");
    if (response.ok) {
      setIsAdministrator(true);
      setAdminOverview(await response.json());
    } else if (response.status === 403) {
      setIsAdministrator(false);
      if (view === "admin") setView("home");
    }
  }

  useEffect(() => {
    if (user) loadAdminOverview();
  }, [user?.id]);

  useEffect(() => {
    if (!user) {
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
  }, [user?.id]);

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
    if (user && (view === "home" || view === "history")) loadHistory();
  }, [user, view]);

  function applyWorkspace(payload) {
    setInputs(payload.inputs);
    setCalculationType(payload.calculationType);
    setCashEntries(payload.cashEntries);
    setCashFilters(payload.cashFilters);
    setOrganizationName(payload.organizationName);
    setSaveTitle(payload.saveTitle);
    setFinanceState(payload.financeState);
    setPricingState(payload.pricingState);
    setFinancialAccounts(payload.financialAccounts);
    setInventoryState(payload.inventoryState);
    setCommerceOrders(payload.commerceOrders);
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
  async function loadHistory(type) {
    setHistoryLoading(true);
    try {
      const response = await fetch(
        `/api/history${type ? `?type=${encodeURIComponent(type)}` : ""}`,
      );
      if (response.ok) setHistory((await response.json()).items);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function startNewDocument(type) {
    // Antes de limpar a área atual, preserva sua última revisão no histórico da conta.
    await archiveCurrentWorkspace();
    // Cada atalho inicia um documento realmente vazio no módulo correspondente.
    if (type === "calculator") {
      setInputs(emptyInputs());
      setSaveTitle("Nova simulação financeira");
    } else if (type === "financing") {
      setFinanceState(emptyFinanceState());
    } else if (type === "pricing") {
      setPricingState(emptyPricingState());
    } else if (type === "cashflow") {
      setCashEntries([blankCashRow()]);
      setFinancialAccounts([emptyFinancialAccount()]);
      setOrganizationName("Nova organização financeira");
      setCashFilters({ month: "", type: "todos", category: "todos" });
    } else if (type === "inventory") {
      setInventoryState(emptyInventoryState());
    } else if (type === "commerce") {
      setCommerceOrders([emptyCommerceOrder()]);
    }
    setNotice("");
    setView(type);
  }

  function changeAccountStatus(index, nextStatus) {
    const account = financialAccounts[index];
    if (!account) return;
    const settled = nextStatus === "pago" || nextStatus === "recebido";
    if (!settled) {
      setFinancialAccounts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, status: nextStatus } : item));
      return;
    }
    if (!(Number(account.amount) > 0)) {
      setNotice("Informe um valor maior que zero antes de dar baixa na conta.");
      return;
    }
    const cashType = account.type === "pagar" ? "saida" : "entrada";
    const similar = cashEntries.some((entry) =>
      entry.type === cashType && Math.abs(Number(entry.amount) - Number(account.amount)) < 0.01 &&
      (!account.dueDate || !entry.date || entry.date === account.dueDate),
    );
    const similarAccount = financialAccounts.some((item, itemIndex) =>
      itemIndex !== index && item.type === account.type &&
      Math.abs(Number(item.amount) - Number(account.amount)) < 0.01 &&
      (!account.dueDate || !item.dueDate || item.dueDate === account.dueDate),
    );
    if ((similar || similarAccount) && !confirm("Já existe uma conta ou lançamento de tipo, valor e data parecidos. Deseja lançar mesmo assim?")) return;
    setCashEntries((current) => [...current, {
      ...blankCashRow(),
      date: account.dueDate || today(),
      category: account.category || "Geral",
      description: account.description || account.party || "Baixa de conta",
      type: cashType,
      amount: account.amount,
    }]);
    setFinancialAccounts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, status: nextStatus, postedAt: new Date().toISOString() } : item));
    setNotice(account.type === "pagar" ? "Conta paga e saída lançada no caixa." : "Conta recebida e entrada lançada no caixa.");
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
    if (!order || nextStatus !== "concluido" || order.status === "concluido") {
      setCommerceOrders((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, status: nextStatus } : item));
      return;
    }
    const quantity = Number(order.quantity);
    const productIndex = inventoryState.products.findIndex((product) => product.sku && product.sku.trim().toLowerCase() === String(order.sku || "").trim().toLowerCase());
    if (!(quantity > 0) || productIndex < 0) {
      if (!confirm("SKU ou quantidade não corresponde ao estoque. Concluir o pedido sem alterar o estoque?")) return;
    } else {
      const product = inventoryState.products[productIndex];
      const currentQuantity = Number(product.quantity) || 0;
      const nextQuantity = order.type === "venda" ? currentQuantity - quantity : currentQuantity + quantity;
      const verb = order.type === "venda" ? "retirar" : "adicionar";
      const negativeWarning = nextQuantity < 0 ? ` Isso deixará o estoque em ${nextQuantity}.` : "";
      if (!confirm(`Concluir o pedido e ${verb} ${quantity} unidade(s) do estoque de ${product.name || product.sku}?${negativeWarning}`)) return;
      setInventoryState((current) => ({ ...current, products: current.products.map((item, itemIndex) => itemIndex === productIndex ? { ...item, quantity: String(nextQuantity) } : item) }));
    }
    setCommerceOrders((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, status: nextStatus, stockUpdatedAt: new Date().toISOString() } : item));
    setNotice("Pedido concluído com a atualização confirmada.");
  }

  async function downloadTestInvoice(order) {
    if (!order?.partner || !(Number(order.amount) > 0)) {
      setNotice("Informe cliente/fornecedor e valor para gerar o documento de teste.");
      return;
    }
    const response = await fetch("/api/export/pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      title: "DOCUMENTO DE TESTE — SEM VALOR FISCAL",
      calculationType: "documento-sem-valor-fiscal",
      payload: { table: [{ pedido: order.number || "Sem número", tipo: order.type, clienteFornecedor: order.partner, data: order.date || today(), sku: order.sku, quantidade: order.quantity, valor: Number(order.amount), observacao: "NÃO É NOTA FISCAL" }] },
    }) });
    if (!response.ok) return setNotice("Não foi possível gerar o documento de teste.");
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a"); link.href = url; link.download = `documento-teste-${order.number || "pedido"}.pdf`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    setNotice("Documento de teste baixado. Ele não possui validade fiscal.");
  }

  function selectedExportRows() {
    const rows = [];
    if (exportSections.calculations) {
      result.table.filter((item) => Number(item.flow)).forEach((item) => rows.push({ secao: "Cálculos", descricao: `Período ${item.period}`, data: item.date, valor: item.flow, status: calculationType }));
      financialTableResult.rows.forEach((item) => rows.push({ secao: "Tabela financeira", descricao: `Parcela ${item.period}`, data: item.date, valor: item.payment, status: financeState.system }));
    }
    if (exportSections.finance) {
      financialAccounts.filter((item) => item.description || Number(item.amount)).forEach((item) => rows.push({ secao: "Contas e cobranças", descricao: item.description || item.party, data: item.dueDate, valor: item.amount, status: item.status }));
      cashEntries.filter((item) => item.description || Number(item.amount)).forEach((item) => rows.push({ secao: "Fluxo de caixa", descricao: item.description, data: item.date, valor: item.type === "saida" ? -Number(item.amount) : Number(item.amount), status: item.category }));
    }
    if (exportSections.inventory) {
      inventoryState.products.filter((item) => item.name || item.sku).forEach((item) => rows.push({ secao: "Estoque", descricao: `${item.name} · SKU ${item.sku}`, data: "", valor: item.quantity, status: item.location }));
      inventoryState.deliveries.filter((item) => item.description).forEach((item) => rows.push({ secao: "Logística", descricao: item.description, data: item.date, valor: "", status: item.status }));
    }
    if (exportSections.commerce) commerceOrders.filter((item) => item.number || item.partner || Number(item.amount)).forEach((item) => rows.push({ secao: item.type === "venda" ? "Vendas" : "Compras", descricao: `${item.number || "Pedido"} · ${item.partner}`, data: item.date, valor: item.amount, status: item.status }));
    return rows;
  }

  async function exportSelected(format) {
    const rows = selectedExportRows();
    if (!rows.length) return setNotice("As seções selecionadas ainda não possuem dados para exportar.");
    const report = { title: "Relatório operacional selecionado", calculationType: "exportacao-selecionada", payload: { table: rows } };
    if (format === "drive") {
      const item = await createModuleHistory({ ...report, success: "Seleção preparada para o Google Drive.", navigate: false });
      if (!item) return;
      if (driveStatus.connected) await sendHistoryToDrive(item); else connectGoogleDrive(item);
      return;
    }
    if (format === "pdf") {
      const response = await fetch("/api/export/pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(report) });
      if (!response.ok) return setNotice("Não foi possível gerar o PDF selecionado.");
      const url = URL.createObjectURL(await response.blob()); const link = document.createElement("a"); link.href = url; link.download = "relatorio-selecionado.pdf"; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      return setNotice("PDF das seções selecionadas baixado.");
    }
    const safe = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const csv = ["sep=;", Object.keys(rows[0]).map(safe).join(";"), ...rows.map((row) => Object.values(row).map(safe).join(";"))].join("\r\n");
    const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" })); const link = document.createElement("a"); link.href = url; link.download = "relatorio-selecionado.csv"; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    setNotice("CSV das seções selecionadas baixado.");
  }
  async function saveCalculation() {
    const hasFinancialTable =
      Number(financeState.form.principal) > 0 &&
      Number(financeState.form.periods) > 0;
    const response = await fetch("/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: saveTitle,
        calculationType,
        payload: {
          inputs,
          result,
          table: result.table,
          // Se a pessoa preencheu a tabela financeira, estado e memória ficam no mesmo histórico.
          financeState: hasFinancialTable ? financeState : undefined,
          financialTable: hasFinancialTable
            ? { state: financeState, result: financialTableResult }
            : undefined,
        },
      }),
    });
    const data = await response.json();
    setNotice(
      response.ok ? "Cálculo salvo no histórico da sua conta." : data.error,
    );
    if (response.ok) {
      // Impede que o mesmo conteúdo seja arquivado novamente ao sair.
      await persistWorkspace(workspacePayload, true);
      setView("history");
    }
  }
  async function createModuleHistory({ title, calculationType, payload, success, navigate = true }) {
    // Todos os módulos usam a mesma rota para manter validação, limite e vínculo com a conta.
    const response = await fetch("/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, calculationType, payload }),
    });
    const data = await response.json();
    setNotice(response.ok ? success : data.error || "Não foi possível salvar no histórico.");
    if (response.ok) {
      await persistWorkspace(workspacePayload, true);
      if (navigate) setView("history");
      return data.item;
    }
    return null;
  }
  async function saveFinancialTable() {
    if (!financialTableResult.rows.length) {
      setNotice("Preencha o valor financiado e a quantidade de parcelas antes de salvar.");
      return;
    }
    await createModuleHistory({
      title: `Tabela ${financeState.system}`,
      calculationType: "tabela-financeira",
      payload: {
        financeState,
        financialTable: { state: financeState, result: financialTableResult },
        table: financialTableResult.rows,
      },
      success: "Tabela financeira salva no histórico da sua conta.",
    });
  }
  async function exportFinancialTableToDrive() {
    if (!financialTableResult.rows.length) {
      setNotice("Preencha o valor financiado e a quantidade de parcelas antes de exportar.");
      return;
    }
    const item = await createModuleHistory({
      title: `Tabela ${financeState.system}`,
      calculationType: "tabela-financeira",
      payload: {
        financeState,
        financialTable: { state: financeState, result: financialTableResult },
        table: financialTableResult.rows,
      },
      success: "Tabela salva. Preparando o envio ao Google Drive…",
      navigate: false,
    });
    if (!item) return;
    // Se ainda não houver conexão, o OAuth guarda este ID e retoma o envio no retorno.
    if (driveStatus.connected) await sendHistoryToDrive(item);
    else connectGoogleDrive(item);
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
    const response = await fetch("/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: organizationName || "Organização financeira",
        calculationType: "fluxo-caixa",
        payload: {
          organizationName,
          entries: normalized,
          table: normalized,
        },
      }),
    });
    setNotice(
      response.ok
        ? "Organização financeira salva na sua conta."
        : "Não foi possível salvar a organização.",
    );
    if (response.ok) {
      await persistWorkspace(workspacePayload, true);
      setView("history");
    }
  }
  async function deleteHistory(id) {
    if (!confirm("Excluir este registro salvo?")) return;
    const response = await fetch(`/api/history/${id}`, { method: "DELETE" });
    if (response.ok) setHistory(history.filter((item) => item.id !== id));
  }
  function connectGoogleDrive(item) {
    // Guarda no fluxo OAuth qual arquivo deve ser enviado após a conexão.
    window.location.assign(`/api/google-drive/connect?historyId=${encodeURIComponent(item.id)}`);
  }
  async function sendHistoryToDrive(item) {
    setDriveUpload({ id: item.id, status: "sending", file: null });
    setNotice("Enviando a planilha Excel ao Google Drive…");
    const response = await fetch(`/api/history/${item.id}/drive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
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
    setFileDownload({ id: item.id, format });
    setNotice(`Preparando arquivo ${format.toUpperCase()}…`);
    try {
      const response = await fetch(`/api/history/${item.id}/${format}`);
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || `Falha ao gerar ${format.toUpperCase()}.`);
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const serverName = disposition.match(/filename="([^"]+)"/)?.[1];
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = serverName || `historico-${item.id}.${format}`;
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
    setView("calculator");
  }
  function loadHistoryItem(item) {
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

  function downloadCurrentCsv() {
    const reports = {
      dashboard: { filename: "visao-geral.csv", title: "Visão geral", rows: result.table, totalSpent: result.totalOutflows },
      calculator: { filename: "calculadora.csv", title: saveTitle, rows: result.table, totalSpent: result.totalOutflows },
      financing: { filename: `tabela-${financeState.system.toLowerCase()}.csv`, title: `Tabela ${financeState.system}`, rows: financialTableResult.rows, totalSpent: financialTableResult.totalPaid },
      pricing: {
        filename: "preco-produto.csv", title: "Preço do produto",
        rows: [
          ...pricingState.expenses.map((expense) => ({ item: expense.name, valor: Number(expense.amount) || 0 })),
          { item: "Custo unitário", valor: pricingResult.unitCost },
          { item: "Preço unitário", valor: pricingResult.unitPrice },
          { item: "Lucro unitário", valor: pricingResult.unitProfit },
        ], totalSpent: pricingResult.totalCost,
      },
      cashflow: {
        filename: "organizacao-financeira.csv",
        title: organizationName,
        rows: [
          ...financialAccounts.map((item) => ({ registro: "Conta", tipo: item.type, descricao: item.description, parceiro: item.party, data: item.dueDate, valor: item.amount, status: item.status })),
          ...cashEntries.map((item) => ({ registro: "Caixa", tipo: item.type, descricao: item.description, parceiro: item.category, data: item.date, valor: item.amount, status: "realizado" })),
        ],
        totalSpent: cashEntries.reduce(
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
        filename: "vendas-compras.csv", title: "Vendas e compras", rows: commerceOrders,
        totalSpent: commerceOrders.reduce((sum, item) => sum + (item.type === "compra" && item.status !== "cancelado" ? Number(item.amount) || 0 : 0), 0),
        summaryLabel: "Total dos pedidos de compra",
      },
    };
    const report = reports[view];
    if (!report) return;
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
    link.download = report.filename;
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
        ? { title: "Vendas e compras", calculationType: "vendas-compras", payload: { table: commerceOrders } }
        : null,
    };
    const report = reports[view];
    if (!report) {
      setNotice("Preencha e calcule os dados desta aba antes de gerar o PDF.");
      return;
    }
    setCurrentPdfLoading(true);
    setNotice("Gerando relatório PDF…");
    try {
      const response = await fetch("/api/export/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(report),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Não foi possível gerar o PDF.");
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `finsight-${view}.pdf`;
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
    applyWorkspace(restored);
    setNotice("Rascunho restaurado. As alterações voltarão a ser salvas automaticamente.");
    setView("dashboard");
  }
  if (checking || (user && !workspaceReady))
    return <div className="loading">Carregando os dados da sua conta…</div>;
  if (!user) return <AuthScreen onAuthenticated={setUser} />;
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
          <i>CT</i> CandTech
        </div>
        <div className="workspace">Gestão pessoal</div>
        <nav aria-label="Navegação principal">
          {[
            ["home", "Início", "⌂"],
            ["dashboard", "Visão geral", "◈"],
            ["calculator", "Calculadoras", "⌁"],
            ["financing", "Tabela financeira", "▦"],
            ["pricing", "Preço do produto", "◇"],
            ["cashflow", "Financeiro", "▤"],
            ["inventory", "Estoque e logística", "▣"],
            ["commerce", "Vendas e compras", "⇄"],
            ...(isAdministrator ? [["admin", "Moderação", "◉"]] : []),
            ["history", "Histórico", "◷"],
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
              {view === "home" ? "ESPAÇO DE TRABALHO" : "PAINEL FINANCEIRO"}
            </p>
            <h1>
              {view === "home"
                ? "Seus documentos"
                : view === "dashboard"
                ? "Visão geral"
                : view === "calculator"
                  ? "Calculadoras"
                  : view === "financing"
                    ? "Tabela financeira"
                    : view === "pricing"
                      ? "Preço do produto"
                      : view === "cashflow"
                        ? "Financeiro"
                        : view === "inventory"
                          ? "Estoque e logística"
                          : view === "commerce"
                            ? "Vendas e compras"
                            : view === "admin"
                              ? "Moderação do sistema"
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
            {view !== "history" && view !== "home" && (
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
              {[["calculations", "Cálculos e tabelas"], ["finance", "Contas, cobranças e caixa"], ["inventory", "Estoque e logística"], ["commerce", "Vendas e compras"]].map(([id, label]) => <label key={id}><input type="checkbox" checked={exportSections[id]} onChange={(event) => setExportSections((current) => ({ ...current, [id]: event.target.checked }))} /> {label}</label>)}
            </div>
            <div className="module-actions"><button className="secondary-button" onClick={() => exportSelected("csv")}>Baixar CSV</button><button className="secondary-button" onClick={() => exportSelected("pdf")}>Baixar PDF</button><button className="primary-button" onClick={() => exportSelected("drive")}>Enviar ao Drive</button></div>
          </section>
        )}
        {view === "home" && (
          <DocumentHome
            user={user}
            items={history}
            loading={historyLoading}
            onNew={startNewDocument}
            onOpen={loadHistoryItem}
            onRestore={restoreAutomaticDraft}
            onViewAll={() => setView("history")}
          />
        )}
        {view === "dashboard" && (
          <Dashboard result={result} onOpen={() => setView("calculator")} />
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
              onStatusChange={changeAccountStatus} onScanRequest={scanBillImage} />
            <CashFlow organizationName={organizationName} setOrganizationName={setOrganizationName}
              entries={cashEntries} filteredEntries={filteredCashEntries} filters={cashFilters}
              setFilters={setCashFilters} setEntries={setCashEntries} totals={cashTotals}
              onSave={saveCashFlow} />
          </div>
        )}
        {view === "inventory" && <InventoryLogistics state={inventoryState} setState={setInventoryState} />}
        {view === "commerce" && <SalesPurchases orders={commerceOrders} setOrders={setCommerceOrders}
          onStatusChange={changeOrderStatus} onTestInvoice={downloadTestInvoice} />}
        {view === "admin" && isAdministrator && <AdminOverview overview={adminOverview} onRefresh={loadAdminOverview} />}
        {view === "history" && (
          <History
            items={history}
            onLoad={loadHistoryItem}
            onRestore={restoreAutomaticDraft}
            onDelete={deleteHistory}
            onRefresh={loadHistory}
            driveStatus={driveStatus}
            onConnectDrive={connectGoogleDrive}
            onSendToDrive={sendHistoryToDrive}
            onDisconnectDrive={disconnectGoogleDrive}
            driveUpload={driveUpload}
            fileDownload={fileDownload}
            onDownload={downloadHistoryFile}
          />
        )}
      </section>
    </main>
  );
}

const DOCUMENT_TYPES = {
  VPL: { label: "Análise de investimento", icon: "↗", tone: "violet" },
  TIR: { label: "Análise de investimento", icon: "↗", tone: "violet" },
  Payback: { label: "Análise de investimento", icon: "↗", tone: "violet" },
  "tabela-financeira": { label: "Tabela financeira", icon: "▦", tone: "blue" },
  "preco-produto": { label: "Preço do produto", icon: "◇", tone: "orange" },
  "organizacao-financeira": { label: "Financeiro", icon: "◫", tone: "green" },
  "rascunho-automatico": { label: "Rascunho automático", icon: "✎", tone: "gray" },
};

const DOCUMENT_TEMPLATES = [
  { id: "calculator", title: "Análise de investimento", text: "VPL, TIR, ROI e payback", icon: "↗", tone: "violet" },
  { id: "financing", title: "Tabela financeira", text: "PRICE, SAF, SAC ou SAA", icon: "▦", tone: "blue" },
  { id: "pricing", title: "Preço do produto", text: "Custos, margem e preço unitário", icon: "◇", tone: "orange" },
  { id: "cashflow", title: "Financeiro", text: "Contas, extratos e fluxo de caixa", icon: "◫", tone: "green" },
  { id: "inventory", title: "Estoque e logística", text: "Produtos, quantidades e entregas", icon: "▣", tone: "blue" },
  { id: "commerce", title: "Vendas e compras", text: "Pedidos, clientes e fornecedores", icon: "⇄", tone: "orange" },
];

function DocumentHome({ user, items, loading, onNew, onOpen, onRestore, onViewAll }) {
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

      <section className="home-section" id="document-templates">
        <div className="home-section-heading">
          <div>
            <span className="eyebrow">COMEÇAR</span>
            <h2>Escolha um modelo</h2>
          </div>
        </div>
        <div className="template-grid">
          {DOCUMENT_TEMPLATES.map((template) => (
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

      <section className="home-section recent-section">
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
      </section>
    </div>
  );
}

function Dashboard({ result, onOpen }) {
  return (
    <>
      <section className="stats-grid">
        <StatCard
          label="VPL estimado"
          value={money.format(result.npv)}
          positive={result.npv >= 0}
          caption="Valor presente líquido"
        />
        <StatCard
          label="ROI"
          value={pct(result.roi)}
          positive={result.roi >= 0}
          caption="Retorno sobre investimento"
        />
        <StatCard
          label="TIR"
          value={pct(result.irr)}
          positive={Number.isFinite(result.irr) && result.irr >= 0}
          caption={
            Number.isFinite(result.irr)
              ? "Taxa interna de retorno"
              : "Fluxo sem TIR única no intervalo"
          }
        />
        <StatCard
          label="Payback"
          value={result.paybackDuration || "N/D"}
          positive
          caption={
            result.paybackDate
              ? `Recuperação em ${formatDate(result.paybackDate)}`
              : "Tempo de retorno"
          }
        />
      </section>
      <section className="dashboard-grid">
        <article className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">ANÁLISE DE FLUXO</span>
              <h2>Entradas e saídas previstas</h2>
            </div>
            <button className="secondary-button" onClick={onOpen}>
              Editar cálculo
            </button>
          </div>
          <CashFlowChart rows={result.table} />
        </article>
        <article className="panel indicator-panel">
          <span className="eyebrow">INDICADORES</span>
          <h2>Retorno do projeto</h2>
          <Indicator
            label="Índice de lucratividade"
            value={(result.profitabilityIndex ?? 0) * 100}
            display={
              Number.isFinite(result.profitabilityIndex)
                ? `${result.profitabilityIndex.toFixed(3)}×`
                : "N/D"
            }
          />
          <div className="mini-stats">
            <span>
              Capital desembolsado
              <strong>{money.format(result.totalOutflows)}</strong>
            </span>
            <span>
              Resultado líquido
              <strong className={result.net >= 0 ? "positive" : "negative"}>
                {money.format(result.net)}
              </strong>
            </span>
          </div>
          <div className="callout">
            O ROE não é calculado aqui: ele exige lucro líquido contábil e
            patrimônio líquido médio, dados diferentes do fluxo do projeto.
          </div>
        </article>
      </section>
    </>
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
                      {money.format(row.flow)}
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
  onSave,
}) {
  const [pdfState, setPdfState] = useState({ loading: false, message: "" });
  const categories = [
    ...new Set(entries.map((entry) => entry.category).filter(Boolean)),
  ];
  function edit(index, field, value) {
    setEntries((current) => {
      const copy = [...current];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  }
  function addEntry() {
    // Remove filtros para garantir que o lançamento recém-criado fique visível.
    setFilters({ month: "", type: "todos", category: "todos" });
    setEntries((current) => [...current, blankCashRow()]);
  }
  function removeEntry(index) {
    const entry = entries[index];
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
        return [...existing, ...imported].sort((a, b) =>
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
          value={money.format(totals.income)}
          caption="No período selecionado"
        />
        <StatCard
          label="Saídas"
          value={money.format(totals.expense)}
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
            O PDF é processado localmente no navegador e não é enviado ao
            servidor.
          </small>
        </div>
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
              {categories.map((category) => (
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
                    <input
                      list="financial-categories"
                      value={entry.category}
                      onChange={(e) =>
                        edit(entry.originalIndex, "category", e.target.value)
                      }
                    />
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
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0,00"
                      value={entry.amount}
                      onChange={(e) =>
                        edit(entry.originalIndex, "amount", e.target.value)
                      }
                    />
                  </td>
                  <td
                    className={
                      entry.runningBalance >= 0 ? "positive" : "negative"
                    }
                  >
                    {money.format(entry.runningBalance)}
                  </td>
                  <td>
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
          <datalist id="financial-categories">
            <option value="Alimentação" />
            <option value="Moradia" />
            <option value="Transporte" />
            <option value="Saúde" />
            <option value="Educação" />
            <option value="Lazer" />
            <option value="Impostos e taxas" />
            <option value="Receitas" />
            <option value="Outros" />
          </datalist>
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
      )}
    </article>
  );
}
