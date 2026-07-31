"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ExpensePieChart,
  FinanceTables,
  ProductPricing,
  parseBankStatementPdf,
} from "./advanced-tools";

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const pct = (number) =>
  `${Number.isFinite(number) ? number.toFixed(2) : "0.00"}%`;
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

function parseSimpleDate(value) {
  const [year, month, day] = String(value || "")
    .slice(0, 10)
    .split("-")
    .map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function addCalendarMonths(date, months) {
  // Preserva o dia quando possível e usa o último dia em meses mais curtos.
  const target = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1),
  );
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return target;
}

function interpolateDate(startValue, endValue, fraction) {
  // Localiza o dia aproximado dentro do intervalo em que o saldo chega a zero.
  const start = parseSimpleDate(startValue);
  const end = parseSimpleDate(endValue);
  if (!start || !end || end < start) return null;
  const ratio = Math.min(1, Math.max(0, fraction));
  return new Date(start.getTime() + (end.getTime() - start.getTime()) * ratio)
    .toISOString()
    .slice(0, 10);
}

function formatDuration(startValue, endValue) {
  const start = parseSimpleDate(startValue);
  const end = parseSimpleDate(endValue);
  if (!start || !end || end < start) return null;

  let cursor = start;
  let years = end.getUTCFullYear() - cursor.getUTCFullYear();
  let candidate = addCalendarMonths(cursor, years * 12);
  if (candidate > end) {
    years -= 1;
    candidate = addCalendarMonths(cursor, years * 12);
  }
  cursor = candidate;

  let months =
    (end.getUTCFullYear() - cursor.getUTCFullYear()) * 12 +
    end.getUTCMonth() -
    cursor.getUTCMonth();
  candidate = addCalendarMonths(cursor, months);
  if (candidate > end) {
    months -= 1;
    candidate = addCalendarMonths(cursor, months);
  }
  cursor = candidate;

  const days = Math.round((end.getTime() - cursor.getTime()) / 86_400_000);
  const parts = [];
  if (years) parts.push(`${years} ${years === 1 ? "ano" : "anos"}`);
  if (months) parts.push(`${months} ${months === 1 ? "mês" : "meses"}`);
  if (days || parts.length === 0)
    parts.push(`${days} ${days === 1 ? "dia" : "dias"}`);
  return parts.length > 1
    ? `${parts.slice(0, -1).join(", ")} e ${parts.at(-1)}`
    : parts[0];
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

function calculate({ investment, investmentDate, rate, periods, flows }) {
  const initial = Number(investment) || 0;
  const monthlyRate = (Number(rate) || 0) / 100;
  // Cada fluxo carrega data e valor; entradas são positivas e saídas negativas.
  const cashFlows = flows
    .map((flow, index) => {
      const normalized = normalizeProjectionFlow(flow, index);
      return { ...normalized, amount: Number(normalized.amount) || 0 };
    })
    .slice(0, Math.max(1, Number(periods) || flows.length));
  let accumulated = -initial;
  let payback = null;
  let paybackDate = null;
  const table = [
    {
      period: 0,
      date: investmentDate || today(),
      flow: -initial,
      discounted: -initial,
      accumulated,
    },
  ];
  const discounted =
    -initial +
    cashFlows.reduce(
      (sum, flow, index) =>
        sum + flow.amount / (1 + monthlyRate) ** (index + 1),
      0,
    );
  cashFlows.forEach((cashFlow, index) => {
    const flow = cashFlow.amount;
    const previous = accumulated;
    accumulated += flow;
    if (payback === null && accumulated >= 0 && flow > 0) {
      const fraction = Math.abs(previous) / flow;
      payback = index + fraction;
      const previousDate =
        index === 0 ? investmentDate || today() : cashFlows[index - 1].date;
      paybackDate = interpolateDate(previousDate, cashFlow.date, fraction);
    }
    table.push({
      period: index + 1,
      date: cashFlow.date,
      flow,
      discounted: flow / (1 + monthlyRate) ** (index + 1),
      accumulated,
    });
  });
  let low = -0.9999;
  let high = 10;
  let irr = 0;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    irr = (low + high) / 2;
    const npvAtRate =
      -initial +
      cashFlows.reduce(
        (sum, flow, index) => sum + flow.amount / (1 + irr) ** (index + 1),
        0,
      );
    if (npvAtRate > 0) low = irr;
    else high = irr;
  }
  const totalIn = cashFlows.reduce((sum, item) => sum + item.amount, 0);
  const net = totalIn - initial;
  return {
    table,
    npv: discounted,
    irr: irr * 100,
    payback,
    paybackDate,
    paybackDuration: paybackDate
      ? formatDuration(investmentDate || today(), paybackDate)
      : null,
    roi: initial ? (net / initial) * 100 : 0,
    profitability: initial ? (discounted / initial) * 100 : 0,
    roe: initial ? (net / initial) * 100 : 0,
    activity: initial ? (totalIn / initial) * 100 : 0,
    totalIn,
    net,
    initial,
    rate: monthlyRate * 100,
  };
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
  };
  return {
    ...defaults,
    ...payload,
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
  const points = rows.map((row, index) => ({
    x: ((index + 0.5) / rows.length) * chartWidth,
    y: 95 - (row.flow / maxValue) * 68,
  }));

  return (
    <div className="fc-chart-scroll" aria-label="Gráfico do fluxo de caixa">
      <div className="fc-chart" style={{ width: `${chartWidth}px` }}>
        <svg
          className="fc-line"
          viewBox={`0 0 ${chartWidth} 190`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polyline
            points={points.map((point) => `${point.x},${point.y}`).join(" ")}
          />
          {points.map((point, index) => (
            <circle
              key={`${rows[index].period}-${rows[index].date}`}
              cx={point.x}
              cy={point.y}
              r="4"
              className={rows[index].flow >= 0 ? "income" : "expense"}
            />
          ))}
        </svg>
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
          const tooltip = `${formatDate(row.date)} · ${movement} de ${money.format(Math.abs(row.flow))} · ${isIncome ? "positivo" : "negativo"}`;
          return (
            <div
              className="fc-column"
              key={`${row.period}-${row.date}`}
              tabIndex="0"
              aria-label={tooltip}
            >
              <div className="fc-track">
                <span className="fc-tooltip">{tooltip}</span>
                <i
                  className={isIncome ? "fc-bar income" : "fc-bar expense"}
                  style={{ height: `${height}px` }}
                />
              </div>
              <strong className={isIncome ? "positive" : "negative"}>
                {movement}: {money.format(Math.abs(row.flow))}
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
          <i>F</i> FinSight
        </div>
        <h1>Suas decisões financeiras, em uma só visão.</h1>
        <p>
          Calcule, organize fluxos e mantenha dados salvos de forma privada por
          conta.
        </p>
        <div className="auth-points">
          <span>✓ Histórico por conta</span>
          <span>✓ CSV compatível com Excel</span>
          <span>✓ Senhas com hash seguro</span>
        </div>
      </section>
      <section className="auth-card">
        <p className="eyebrow">BEM-VINDO</p>
        <h2>{mode === "login" ? "Acesse sua conta" : "Crie sua conta"}</h2>
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
              placeholder="Ao menos 8 caracteres"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
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
  const [view, setView] = useState("dashboard");
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
  const [notice, setNotice] = useState("");
  const [saveTitle, setSaveTitle] = useState("Simulação financeira");
  const [financeState, setFinanceState] = useState(emptyFinanceState);
  const [pricingState, setPricingState] = useState(emptyPricingState);
  const lastSavedWorkspace = useRef("");
  const autoSaveTimer = useRef(null);
  const result = useMemo(() => calculate(inputs), [inputs]);
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
    if (user && view === "history") loadHistory();
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
    const response = await fetch(
      `/api/history${type ? `?type=${encodeURIComponent(type)}` : ""}`,
    );
    if (response.ok) setHistory((await response.json()).items);
  }
  async function saveCalculation() {
    const response = await fetch("/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: saveTitle,
        calculationType,
        payload: { inputs, result, table: result.table },
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
    setView("dashboard");
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
    setCalculationType(item.calculation_type);
    setSaveTitle(item.title);
    setView("calculator");
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
          <i>F</i> FinSight
        </div>
        <div className="workspace">Gestão pessoal</div>
        <nav aria-label="Navegação principal">
          {[
            ["dashboard", "Visão geral", "◈"],
            ["calculator", "Calculadoras", "⌁"],
            ["financing", "Tabela financeira", "▦"],
            ["pricing", "Preço do produto", "◇"],
            ["cashflow", "Organização financeira", "▤"],
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
            <p className="eyebrow">PAINEL FINANCEIRO</p>
            <h1>
              {view === "dashboard"
                ? "Visão geral"
                : view === "calculator"
                  ? "Calculadoras"
                  : view === "financing"
                    ? "Tabela financeira"
                    : view === "pricing"
                      ? "Preço do produto"
                      : view === "cashflow"
                        ? "Organização financeira"
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
            <button
              className="primary-button compact"
              onClick={() => setView("calculator")}
            >
              + Novo cálculo
            </button>
          </div>
        </header>
        {notice && (
          <div className="notice">
            {notice}
            <button onClick={() => setNotice("")}>×</button>
          </div>
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
          />
        )}
        {view === "financing" && (
          <FinanceTables state={financeState} setState={setFinanceState} />
        )}
        {view === "pricing" && (
          <ProductPricing state={pricingState} setState={setPricingState} />
        )}
        {view === "cashflow" && (
          <CashFlow
            organizationName={organizationName}
            setOrganizationName={setOrganizationName}
            entries={cashEntries}
            filteredEntries={filteredCashEntries}
            filters={cashFilters}
            setFilters={setCashFilters}
            setEntries={setCashEntries}
            totals={cashTotals}
            onSave={saveCashFlow}
          />
        )}
        {view === "history" && (
          <History
            items={history}
            onLoad={loadCalculation}
            onRestore={restoreAutomaticDraft}
            onDelete={deleteHistory}
            onRefresh={loadHistory}
          />
        )}
      </section>
    </main>
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
          positive={result.irr >= 0}
          caption="Taxa interna de retorno"
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
          <h2>Rentabilidade</h2>
          <Indicator label="Rentabilidade" value={result.profitability} />
          <Indicator label="ROE" value={result.roe} />
          <Indicator label="Atividade" value={result.activity} />
          <div className="callout">
            Dados calculados com base no capital próprio informado e no fluxo
            projetado.
          </div>
        </article>
      </section>
    </>
  );
}
function Indicator({ label, value }) {
  return (
    <div className="indicator">
      <span>{label}</span>
      <strong>{pct(value)}</strong>
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
}) {
  return (
    <>
      <section className="calculator-toolbar">
        <div className="calculation-tabs">
          {["VPL", "TIR", "Payback", "ROI"].map((type) => (
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
              Taxa por período (%)
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
            <label>
              Período
              <select>
                <option>Mensal</option>
                <option>Anual</option>
              </select>
            </label>
          </div>
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
              ROE<strong>{pct(result.roe)}</strong>
            </span>
            <span>
              Atividade<strong>{pct(result.activity)}</strong>
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
function History({ items, onLoad, onRestore, onDelete, onRefresh }) {
  return (
    <article className="panel history-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">ARQUIVO DA CONTA</span>
          <h2>Histórico de cálculos e fluxos</h2>
        </div>
        <button className="secondary-button" onClick={() => onRefresh()}>
          ↻ Atualizar
        </button>
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
                {item.payload.inputs && (
                  <button
                    className="secondary-button"
                    onClick={() => onLoad(item)}
                  >
                    {item.calculation_type === "rascunho-automatico"
                      ? "Abrir cálculo"
                      : "Carregar"}
                  </button>
                )}
                <a
                  className="secondary-button"
                  href={`/api/history/${item.id}/csv`}
                >
                  Exportar CSV
                </a>
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
