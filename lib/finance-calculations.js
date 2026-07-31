// Converte valores de formulários em números seguros para os cálculos.
const asNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

// Avança meses sem "pular" para o mês seguinte em datas como dia 29, 30 ou 31.
export function addMonthsToDate(value, months) {
  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return "";
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

/**
 * Monta a memória de um financiamento em Price/SAF, SAA ou SAC.
 * Price e SAF são nomes diferentes para a mesma fórmula de prestação constante.
 */
export function calculateAmortization({
  system,
  principal,
  rate,
  periods,
  startDate,
}) {
  const pv = Math.max(0, asNumber(principal));
  const i = Math.max(0, asNumber(rate)) / 100;
  const n = Math.min(600, Math.max(1, Math.trunc(asNumber(periods) || 1)));
  const normalizedSystem = system === "SAF" ? "PRICE" : system;
  let balance = pv;

  // No sistema francês, PMT = PV × i / (1 − (1 + i)^−n).
  const fixedPayment = i === 0 ? pv / n : (pv * i) / (1 - Math.pow(1 + i, -n));
  // No SAC, o principal é dividido igualmente entre todos os períodos.
  const fixedAmortization = pv / n;
  const rows = [];

  for (let period = 1; period <= n; period += 1) {
    const openingBalance = balance;
    const interest = openingBalance * i;
    let amortization = 0;
    let payment = 0;

    if (normalizedSystem === "PRICE") {
      payment = fixedPayment;
      amortization = payment - interest;
    } else if (normalizedSystem === "SAC") {
      amortization = period === n ? openingBalance : fixedAmortization;
      payment = amortization + interest;
    } else {
      // No SAA tradicional, os juros são pagos em cada período e o principal só no final.
      amortization = period === n ? openingBalance : 0;
      payment = interest + amortization;
    }

    // O último ajuste elimina resíduos de ponto flutuante, sem alterar a fórmula.
    if (period === n && normalizedSystem === "PRICE") {
      amortization = openingBalance;
      payment = interest + amortization;
    }
    balance = Math.max(0, openingBalance - amortization);
    rows.push({
      period,
      date: addMonthsToDate(startDate, period - 1),
      openingBalance,
      payment,
      interest,
      amortization,
      balance,
    });
  }

  const totalPaid = rows.reduce((sum, row) => sum + row.payment, 0);
  const totalInterest = rows.reduce((sum, row) => sum + row.interest, 0);
  return {
    system,
    equivalentSystem: normalizedSystem,
    principal: pv,
    rate: i,
    periods: n,
    rows,
    totalPaid,
    totalInterest,
    firstPayment: rows[0]?.payment || 0,
    lastPayment: rows.at(-1)?.payment || 0,
  };
}

// Calcula preço por margem sobre o valor de venda, e não como simples acréscimo (markup).
export function calculateProductPrice({ expenses, units, margin }) {
  const totalCost = expenses.reduce(
    (sum, expense) => sum + Math.max(0, asNumber(expense.amount)),
    0,
  );
  const quantity = Math.max(1, Math.trunc(asNumber(units) || 1));
  const marginRate = Math.min(99.99, Math.max(0, asNumber(margin))) / 100;
  const unitCost = totalCost / quantity;
  const unitPrice = unitCost / (1 - marginRate);
  return {
    totalCost,
    quantity,
    marginRate,
    unitCost,
    unitPrice,
    unitProfit: unitPrice - unitCost,
    expectedRevenue: unitPrice * quantity,
  };
}
