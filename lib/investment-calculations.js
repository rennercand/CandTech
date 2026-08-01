const DAY_MS = 86_400_000;

const asFiniteNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

function parseSimpleDate(value) {
  const [year, month, day] = String(value || "").slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isFinite(date.getTime()) ? date : null;
}

function addCalendarMonths(date, months) {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return target;
}

function interpolateDate(startValue, endValue, fraction) {
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
    end.getUTCMonth() - cursor.getUTCMonth();
  candidate = addCalendarMonths(cursor, months);
  if (candidate > end) {
    months -= 1;
    candidate = addCalendarMonths(cursor, months);
  }
  cursor = candidate;

  const days = Math.round((end.getTime() - cursor.getTime()) / DAY_MS);
  const parts = [];
  if (years) parts.push(`${years} ${years === 1 ? "ano" : "anos"}`);
  if (months) parts.push(`${months} ${months === 1 ? "mês" : "meses"}`);
  if (days || parts.length === 0) parts.push(`${days} ${days === 1 ? "dia" : "dias"}`);
  return parts.length > 1
    ? `${parts.slice(0, -1).join(", ")} e ${parts.at(-1)}`
    : parts[0];
}

/**
 * Calcula indicadores de um projeto com fluxos igualmente espaçados.
 * A taxa informada sempre corresponde a um período completo (mês ou ano).
 */
export function calculateInvestment({ investment, investmentDate, rate, periods, flows }) {
  const initial = Math.max(0, asFiniteNumber(investment));
  // Taxas iguais ou menores que -100% tornam o desconto matematicamente indefinido.
  const periodRate = Math.max(-0.999999, asFiniteNumber(rate) / 100);
  const requestedPeriods = Math.max(1, Math.trunc(asFiniteNumber(periods) || flows.length || 1));
  const cashFlows = flows.slice(0, requestedPeriods).map((flow) => ({
    date: flow?.date || "",
    amount: asFiniteNumber(flow?.amount ?? flow),
  }));

  let accumulated = -initial;
  let payback = null;
  let paybackDate = null;
  const table = [{
    period: 0,
    date: investmentDate,
    flow: -initial,
    discounted: -initial,
    accumulated,
  }];

  const presentValueFutureFlows = cashFlows.reduce(
    (sum, flow, index) => sum + flow.amount / (1 + periodRate) ** (index + 1),
    0,
  );

  cashFlows.forEach((cashFlow, index) => {
    const previous = accumulated;
    accumulated += cashFlow.amount;
    if (payback === null && accumulated >= 0 && cashFlow.amount > 0) {
      // Payback simples interpolado dentro do período em que o saldo se torna positivo.
      const fraction = Math.abs(previous) / cashFlow.amount;
      payback = index + fraction;
      const previousDate = index === 0 ? investmentDate : cashFlows[index - 1].date;
      paybackDate = interpolateDate(previousDate, cashFlow.date, fraction);
    }
    table.push({
      period: index + 1,
      date: cashFlow.date,
      flow: cashFlow.amount,
      discounted: cashFlow.amount / (1 + periodRate) ** (index + 1),
      accumulated,
    });
  });

  const npvAt = (candidateRate) =>
    -initial + cashFlows.reduce(
      (sum, flow, index) => sum + flow.amount / (1 + candidateRate) ** (index + 1),
      0,
    );
  const signs = [-initial, ...cashFlows.map((flow) => flow.amount)]
    .filter((value) => value !== 0)
    .map(Math.sign);
  const signChanges = signs.reduce(
    (count, sign, index) => count + (index > 0 && sign !== signs[index - 1] ? 1 : 0),
    0,
  );
  let irr = null;
  let low = -0.999999;
  let high = 10;
  let lowValue = npvAt(low);
  let highValue = npvAt(high);
  // Amplia o intervalo para projetos com retorno excepcional, sem limitar a TIR a 1.000%.
  while (Number.isFinite(highValue) && lowValue * highValue > 0 && high < 1_000_000) {
    high *= 10;
    highValue = npvAt(high);
  }
  if (signChanges === 1 && Number.isFinite(lowValue) && Number.isFinite(highValue) && lowValue * highValue <= 0) {
    // Bisseção preserva o intervalo com a raiz e evita resultados instáveis.
    for (let attempt = 0; attempt < 180; attempt += 1) {
      const middle = (low + high) / 2;
      const middleValue = npvAt(middle);
      if (Math.abs(middleValue) < 1e-10) {
        low = middle;
        high = middle;
        break;
      }
      if (lowValue * middleValue <= 0) {
        high = middle;
        highValue = middleValue;
      } else {
        low = middle;
        lowValue = middleValue;
      }
    }
    irr = ((low + high) / 2) * 100;
  }

  const totalNetFlows = cashFlows.reduce((sum, item) => sum + item.amount, 0);
  const totalInflows = cashFlows.reduce((sum, item) => sum + Math.max(0, item.amount), 0);
  const totalOutflows = initial + cashFlows.reduce((sum, item) => sum + Math.abs(Math.min(0, item.amount)), 0);
  const net = totalNetFlows - initial;
  const npv = presentValueFutureFlows - initial;

  return {
    table,
    npv,
    irr,
    payback,
    paybackDate,
    paybackDuration: paybackDate ? formatDuration(investmentDate, paybackDate) : null,
    // ROI de projeto: ganho líquido não descontado dividido por todo o capital desembolsado.
    roi: totalOutflows ? (net / totalOutflows) * 100 : null,
    // Índice de lucratividade: valor presente dos fluxos futuros / investimento inicial.
    profitabilityIndex: initial ? presentValueFutureFlows / initial : null,
    totalInflows,
    totalOutflows,
    net,
    initial,
    rate: periodRate * 100,
  };
}
