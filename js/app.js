// ============================================
// Calculadora Financeira - Frontend com Histórico
// ============================================

let currentTab = "payback";
let fluxos = [];
let ultimoResultadoCalculado = null; // Guarda o último resultado para salvar

const tabs = {
  payback: {
    name: "Payback",
    showTaxa: false,
    showPeriodos: false,
    showFluxos: true,
    colunas: ["n", "II", "Fluxo de Retorno", "Valor a Recuperar"],
  },
  vpl: {
    name: "VPL",
    showTaxa: true,
    showPeriodos: false,
    showFluxos: true,
    colunas: ["n", "Fluxo", "Fator", "VP"],
  },
  tir: {
    name: "TIR",
    showTaxa: false,
    showPeriodos: false,
    showFluxos: true,
    colunas: ["n", "Fluxo"],
  },
  npv: {
    name: "NPV",
    showTaxa: true,
    showPeriodos: false,
    showFluxos: true,
    colunas: ["n", "Fluxo", "Fator", "VP"],
  },
  irr: {
    name: "IRR",
    showTaxa: false,
    showPeriodos: false,
    showFluxos: true,
    colunas: ["n", "Fluxo"],
  },
  icc: {
    name: "ICC",
    showTaxa: true,
    showPeriodos: false,
    showFluxos: true,
    colunas: ["n", "Fluxo"],
  },
  saa: {
    name: "SAA",
    showTaxa: true,
    showPeriodos: true,
    showFluxos: false,
    colunas: [
      "n",
      "Valor da Parcela Total (R$)",
      "Juros Embutidos (R$)",
      "Amortização da Dívida (R$)",
      "Saldo Devedor Restante (R$)",
    ],
  },
  saf: {
    name: "SAF",
    showTaxa: true,
    showPeriodos: true,
    showFluxos: false,
    colunas: [
      "n",
      "Valor da Parcela Total (R$)",
      "Juros Embutidos (R$)",
      "Amortização da Dívida (R$)",
      "Saldo Devedor Restante (R$)",
    ],
  },
  price: {
    name: "Price",
    showTaxa: true,
    showPeriodos: true,
    showFluxos: false,
    colunas: [
      "n",
      "Valor da Parcela Total (R$)",
      "Juros Embutidos (R$)",
      "Amortização da Dívida (R$)",
      "Saldo Devedor Restante (R$)",
    ],
  },
  sac: {
    name: "SAC",
    showTaxa: true,
    showPeriodos: true,
    showFluxos: false,
    colunas: [
      "n",
      "Valor da Parcela Total (R$)",
      "Juros Embutidos (R$)",
      "Amortização da Dívida (R$)",
      "Saldo Devedor Restante (R$)",
    ],
  },
  historico: {
    name: "Histórico",
    showTaxa: false,
    showPeriodos: false,
    showFluxos: false,
    colunas: [],
  },
};

// ============================================
// Inicialização
// ============================================
document.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  setupFluxos();
  setupInputs();
  setupHistoricoEvents();
  updateUI();
  calcular();
});

function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document
        .querySelectorAll(".tab-btn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentTab = btn.dataset.tab;
      updateUI();
      if (currentTab === "historico") {
        renderHistorico();
      } else {
        calcular();
      }
    });
  });
}

function setupFluxos() {
  renderFluxos();
  const btnAdd = document.getElementById("add-fluxo");
  if (btnAdd) {
    // Remove eventuais duplicações e adiciona o clique com segurança
    const novoBtn = btnAdd.cloneNode(true);
    btnAdd.parentNode.replaceChild(novoBtn, btnAdd);

    novoBtn.addEventListener("click", () => {
      fluxos.push(0);
      renderFluxos();
      calcular();
    });
  }
}

function updateUI() {
  const config = tabs[currentTab];
  const isHistorico = currentTab === "historico";

  document.querySelector(".taxa-group").style.display = config.showTaxa
    ? "block"
    : "none";
  document.querySelector(".periodos-group").style.display = config.showPeriodos
    ? "block"
    : "none";
  document.querySelector(".fluxos-container").style.display = config.showFluxos
    ? "block"
    : "none";

  document.querySelector(".investimento-group").style.display =
    currentTab === "saa" ||
    currentTab === "saf" ||
    currentTab === "price" ||
    currentTab === "sac" ||
    isHistorico
      ? "none"
      : "block";

  document.getElementById("calcular").style.display = isHistorico
    ? "none"
    : "block";

  const historicoDiv = document.getElementById("historico-container");
  if (historicoDiv) historicoDiv.style.display = isHistorico ? "block" : "none";

  const tabelaDiv = document.getElementById("tabela-content");
  if (tabelaDiv) tabelaDiv.style.display = isHistorico ? "none" : "block";

  // CORREÇÃO: Só altera o array se o usuário realmente mudou a quantidade de períodos
  // e evita limpar caixas vazias automaticamente
  if (config.showPeriodos) {
    const inputPeriodos = document.getElementById("qtd-periodos");
    const qtd = parseInt(inputPeriodos.value);
    if (!isNaN(qtd) && qtd > 0 && fluxos.length !== qtd) {
      fluxos = Array(qtd).fill(0);
      renderFluxos();
    }
  }
}

function renderFluxos() {
  const container = document.getElementById("fluxos-list");
  container.innerHTML = "";
  fluxos.forEach((valor, i) => {
    const div = document.createElement("div");
    div.className = "fluxo-item";
    div.innerHTML = `
            <span>Período ${i + 1}</span>
            <input type="number" value="${valor}" data-index="${i}" step="1000">
        `;
    container.appendChild(div);
  });

  container.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", (e) => {
      const idx = parseInt(e.target.dataset.index);
      fluxos[idx] = parseFloat(e.target.value) || 0;
      calcular();
    });
  });
}

function setupInputs() {
  document.getElementById("calcular").addEventListener("click", calcular);
  document.getElementById("qtd-periodos").addEventListener("change", calcular);
  document.getElementById("taxa").addEventListener("change", calcular);
  document.getElementById("investimento").addEventListener("change", calcular);
  document.getElementById("periodo-tipo").addEventListener("change", calcular);

  // ADICIONE ESTA LINHA:
  const taxaTipo = document.getElementById("taxa-tipo");
  if (taxaTipo) taxaTipo.addEventListener("change", calcular);
}

function updateUI() {
  const config = tabs[currentTab];
  const isHistorico = currentTab === "historico";

  document.querySelector(".taxa-group").style.display = config.showTaxa
    ? "block"
    : "none";
  document.querySelector(".periodos-group").style.display = config.showPeriodos
    ? "block"
    : "none";
  document.querySelector(".fluxos-container").style.display = config.showFluxos
    ? "block"
    : "none";
  document.querySelector(".investimento-group").style.display = isHistorico
    ? "none"
    : "block";
  currentTab === "saa" ||
  currentTab === "saf" ||
  currentTab === "price" ||
  currentTab === "sac" ||
  isHistorico
    ? "none"
    : "block";

  document.getElementById("calcular").style.display = isHistorico
    ? "none"
    : "block";

  const historicoDiv = document.getElementById("historico-container");
  if (historicoDiv) historicoDiv.style.display = isHistorico ? "block" : "none";

  const tabelaDiv = document.getElementById("tabela-content");
  if (tabelaDiv) tabelaDiv.style.display = isHistorico ? "none" : "block";

  if (config.showPeriodos) {
    const qtd = parseInt(document.getElementById("qtd-periodos").value);
    if (fluxos.length !== qtd) {
      fluxos = Array(qtd).fill(0);
      renderFluxos();
    }
  }
}

// ============================================
// Formatação
// ============================================
function formatMoney(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function formatNumber(value, decimals = 2) {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// Função para converter o Payback de forma bem natural (Anos, Meses e Dias)
function formatarTempoPayback(totalPeriodos, tipoPeriodo) {
  if (totalPeriodos === null || isNaN(totalPeriodos)) return "Não recuperado";

  const anos = Math.floor(totalPeriodos); // Pega os anos inteiros
  const sobraAnos = totalPeriodos - anos; // O que sobrou após os anos

  if (tipoPeriodo === "ano") {
    const mesesTotais = sobraAnos * 12;
    const meses = Math.floor(mesesTotais);
    const dias = Math.round((mesesTotais - meses) * 30); // 30 dias por mês comercial

    let resultadoStr = "";
    if (anos > 0) resultadoStr += `${anos} ano${anos > 1 ? "s" : ""}, `;
    if (meses > 0 || anos > 0)
      resultadoStr += `${meses} mênse${meses > 1 ? "s" : ""} `; // corrigindo o plural se necessário
    resultadoStr += `e ${dias} dia${dias > 1 ? "s" : ""}`;

    // Limpeza simples de texto caso algum valor dê zero exato
    return `${anos} anos, ${meses} meses e ${dias} dias`;
  } else if (tipoPeriodo === "mes") {
    const meses = Math.floor(totalPeriodos);
    const sobraMeses = totalPeriodos - meses;
    const dias = Math.round(sobraMeses * 30);

    return `${meses} meses e ${dias} dias`;
  } else {
    return totalPeriodos.toFixed(2) + " períodos";
  }
}

// ============================================
// Funções de Cálculo (Frontend)
// ============================================
function calcPayback(investimento, fluxos) {
  let acumulado = -investimento;
  let tabela = [];
  let paybackPeriodo = null;
  let paybackFracao = 0;

  tabela.push({ n: 0, ii: investimento, fluxo: 0, recuperar: investimento });

  for (let i = 0; i < fluxos.length; i++) {
    acumulado += fluxos[i];
    let recuperar = acumulado < 0 ? Math.abs(acumulado) : 0;

    if (acumulado >= 0 && paybackPeriodo === null) {
      paybackPeriodo = i;
      let excedente = acumulado;
      let necessario = fluxos[i] - excedente;
      paybackFracao = necessario / fluxos[i];
    }

    tabela.push({
      n: i + 1,
      ii: "",
      fluxo: fluxos[i],
      recuperar: recuperar,
      highlight: paybackPeriodo !== null && paybackPeriodo === i,
    });
  }

  let paybackTotal =
    paybackPeriodo !== null ? paybackPeriodo + paybackFracao : null;
  return { tabela, paybackTotal, paybackPeriodo, paybackFracao };
}

function calcVPL(investimento, fluxos, taxa) {
  let vpl = -investimento;
  let tabela = [];
  let taxaDecimal = taxa / 100;

  tabela.push({ n: 0, fluxo: -investimento, fator: 1, vp: -investimento });

  for (let i = 0; i < fluxos.length; i++) {
    let fator = Math.pow(1 + taxaDecimal, -(i + 1));
    let vp = fluxos[i] * fator;
    vpl += vp;
    tabela.push({ n: i + 1, fluxo: fluxos[i], fator: fator, vp: vp });
  }

  return { tabela, vpl };
}

function calcTIR(investimento, fluxos) {
  let maxIter = 1000;
  let tolerance = 0.000001;
  let low = -0.9999;
  let high = 10;
  let tir = 0;

  for (let iter = 0; iter < maxIter; iter++) {
    tir = (low + high) / 2;
    let npv = -investimento;
    for (let i = 0; i < fluxos.length; i++) {
      npv += fluxos[i] / Math.pow(1 + tir, i + 1);
    }

    if (Math.abs(npv) < tolerance) break;
    if (npv > 0) low = tir;
    else high = tir;
  }

  return { tir: tir * 100 };
}

function calcICC(investimento, fluxos, taxa) {
  let tirResult = calcTIR(investimento, fluxos);
  let tir = tirResult.tir / 100;
  let taxaDecimal = taxa / 100;
  let icc = ((1 + tir) / (1 + taxaDecimal) - 1) * 100;

  return { tir: tirResult.tir, icc, investimento, fluxos };
}

function calcSAA(principal, taxa, periodos) {
  let tabela = [];
  let saldo = principal;
  let jurosTotal = 0;

  // Linha do Período 0 (Início)
  tabela.push({ n: 0, parcela: 0, juros: 0, amortizacao: 0, saldo: principal });

  for (let i = 1; i <= periodos; i++) {
    let juros = saldo * (taxa / 100);
    let parcela = juros;
    let amortizacao = 0;
    jurosTotal += juros;
    tabela.push({ n: i, parcela, juros, amortizacao, saldo });
  }

  return { tabela, jurosTotal, totalPago: jurosTotal };
}

function calcSAF(principal, taxa, periodos) {
  let tabela = [];
  let saldo = principal;
  let jurosTotal = 0;
  let amortizacaoTotal = 0;
  let amortizacao = periodos > 0 ? principal / periodos : 0;

  // Linha do Período 0 (Início)
  tabela.push({ n: 0, parcela: 0, juros: 0, amortizacao: 0, saldo: principal });

  for (let i = 1; i <= periodos; i++) {
    let juros = saldo * (taxa / 100);
    let parcela = amortizacao + juros;
    saldo -= amortizacao;
    jurosTotal += juros;
    amortizacaoTotal += amortizacao;
    tabela.push({
      n: i,
      parcela,
      juros,
      amortizacao,
      saldo: Math.max(0, saldo),
    });
  }

  return {
    tabela,
    jurosTotal,
    amortizacaoTotal,
    totalPago: jurosTotal + amortizacaoTotal,
  };
}

function calcPrice(principal, taxa, periodos) {
  let tabela = [];
  let saldo = principal;
  let jurosTotal = 0;
  let amortizacaoTotal = 0;
  let taxaDecimal = taxa / 100;

  let parcela = 0;
  if (taxaDecimal > 0 && periodos > 0) {
    parcela =
      (principal * (taxaDecimal * Math.pow(1 + taxaDecimal, periodos))) /
      (Math.pow(1 + taxaDecimal, periodos) - 1);
  } else if (periodos > 0) {
    parcela = principal / periodos;
  }

  // Linha do Período 0 (Início)
  tabela.push({ n: 0, parcela: 0, juros: 0, amortizacao: 0, saldo: principal });

  for (let i = 1; i <= periodos; i++) {
    let juros = saldo * taxaDecimal;
    let amortizacao = parcela - juros;
    saldo -= amortizacao;
    jurosTotal += juros;
    amortizacaoTotal += amortizacao;
    tabela.push({
      n: i,
      parcela,
      juros,
      amortizacao,
      saldo: Math.max(0, saldo),
    });
  }

  return {
    tabela,
    jurosTotal,
    amortizacaoTotal,
    totalPago: jurosTotal + amortizacaoTotal,
    parcela,
  };
}

function calcSAC(principal, taxa, periodos) {
  return calcSAF(principal, taxa, periodos);
}

// ============================================
// Execução
// ============================================
async function calcular() {
  if (currentTab === "historico") return;

  const investimento =
    parseFloat(document.getElementById("investimento").value) || 0;
  const taxa = parseFloat(document.getElementById("taxa").value) || 0;
  const periodos = parseInt(document.getElementById("qtd-periodos").value) || 5;
  const tipoPeriodo = document.getElementById("periodo-tipo").value;

  let resultado = {};
  let memoria = [];

  switch (currentTab) {
    case "payback":
      resultado = calcPayback(investimento, fluxos);
      memoria = memoriaPayback(investimento, fluxos, resultado);
      break;
    case "vpl":
    case "npv":
      resultado = calcVPL(investimento, fluxos, taxa);
      memoria = memoriaVPL(investimento, fluxos, taxa, resultado);
      break;
    case "tir":
    case "irr":
      resultado = calcTIR(investimento, fluxos);
      memoria = memoriaTIR(investimento, fluxos, resultado);
      break;
    case "icc":
      resultado = calcICC(investimento, fluxos, taxa);
      memoria = memoriaICC(investimento, fluxos, taxa, resultado);
      break;
    case "saa":
      resultado = calcSAA(investimento || 0, taxa, periodos);
      memoria = memoriaSAA(investimento || 0, taxa, periodos, resultado);
      break;
    case "saf":
      resultado = calcSAF(investimento || 0, taxa, periodos);
      memoria = memoriaSAF(investimento || 0, taxa, periodos, resultado);
      break;
    case "price":
      resultado = calcPrice(investimento || 0, taxa, periodos);
      memoria = memoriaPrice(investimento || 0, taxa, periodos, resultado);
      break;
    case "sac":
      resultado = calcSAC(investimento || 0, taxa, periodos);
      memoria = memoriaSAC(investimento || 0, taxa, periodos, resultado);
      break;
  }

  // Salva o cálculo ativo em memória global
  ultimoResultadoCalculado = {
    tipo: currentTab,
    nomeTipo: tabs[currentTab].name,
    investimento,
    taxa,
    periodos,
    fluxos: [...fluxos],
    resultado,
    data:
      new Date().toLocaleDateString("pt-BR") +
      " " +
      new Date().toLocaleTimeString("pt-BR"),
  };

  renderTabela(resultado, tipoPeriodo);
  renderFluxoCaixa(resultado, tipoPeriodo);
  renderMemoria(memoria, tipoPeriodo);
}

// ============================================
// HISTÓRICO (LOCALSTORAGE)
// ============================================
function setupHistoricoEvents() {
  const btnSalvar = document.getElementById("btn-salvar-historico");
  if (btnSalvar) {
    btnSalvar.addEventListener("click", salvarHistorico);
  }
}

function salvarHistorico() {
  if (!ultimoResultadoCalculado)
    return alert("Nenhum cálculo recente para salvar!");

  const nomeInput = document.getElementById("nome-calculo");
  const nome = nomeInput ? nomeInput.value.trim() : "";

  if (!nome) return alert("Por favor, digite um nome para salvar o cálculo!");

  let historico = JSON.parse(localStorage.getItem("calc_historico") || "[]");

  const novoItem = {
    id: Date.now(),
    nome: nome,
    ...ultimoResultadoCalculado,
  };

  historico.unshift(novoItem);
  localStorage.setItem("calc_historico", JSON.stringify(historico));

  nomeInput.value = "";
  alert("Cálculo salvo com sucesso!");
  renderHistorico();
}

function renderHistorico() {
  const listaContainer = document.getElementById("historico-lista");
  if (!listaContainer) return;

  let historico = JSON.parse(localStorage.getItem("calc_historico") || "[]");

  if (historico.length === 0) {
    listaContainer.innerHTML =
      '<p style="color: #64748b;">Nenhum cálculo salvo ainda.</p>';
    return;
  }

  let html = '<div style="display: flex; flex-direction: column; gap: 12px;">';

  historico.forEach((item) => {
    let resumoValor = "";
    if (item.resultado.vpl !== undefined)
      resumoValor = `VPL: ${formatMoney(item.resultado.vpl)}`;
    else if (item.resultado.paybackTotal !== undefined)
      resumoValor = `Payback: ${item.resultado.paybackTotal ? item.resultado.paybackTotal.toFixed(2) + " per." : "N/A"}`;
    else if (item.resultado.tir !== undefined)
      resumoValor = `TIR: ${item.resultado.tir.toFixed(2)}%`;
    else if (item.resultado.totalPago !== undefined)
      resumoValor = `Total Pago: ${formatMoney(item.resultado.totalPago)}`;

    html += `
            <div style="border: 1px solid #cbd5e1; border-radius: 8px; padding: 14px; background: #fff; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <strong style="font-size: 16px; color: var(--primary);">${item.nome}</strong> 
                    <span style="font-size: 12px; background: #e2e8f0; padding: 2px 6px; border-radius: 4px; margin-left: 8px;">${item.nomeTipo}</span>
                    <div style="font-size: 13px; margin-top: 4px; color: #475569;">
                        ${resumoValor} | Data: ${item.data}
                    </div>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button class="btn-secondary" onclick="carregarHistorico(${item.id})">Carregar</button>
                    <button class="btn-secondary" style="background: #fee2e2; color: #dc2626;" onclick="excluirHistorico(${item.id})">Excluir</button>
                </div>
            </div>
        `;
  });

  html += "</div>";
  listaContainer.innerHTML = html;
}

window.carregarHistorico = function (id) {
  let historico = JSON.parse(localStorage.getItem("calc_historico") || "[]");
  let item = historico.find((h) => h.id === id);

  if (!item) return;

  currentTab = item.tipo;
  fluxos = [...item.fluxos];

  document.getElementById("investimento").value = item.investimento;
  document.getElementById("taxa").value = item.taxa;
  document.getElementById("qtd-periodos").value = item.periodos;

  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === currentTab);
  });

  renderFluxos();
  updateUI();
  calcular();
  alert(`Cálculo "${item.nome}" carregado!`);
};

window.excluirHistorico = function (id) {
  let historico = JSON.parse(localStorage.getItem("calc_historico") || "[]");
  historico = historico.filter((h) => h.id !== id);
  localStorage.setItem("calc_historico", JSON.stringify(historico));
  renderHistorico();
};

// ============================================
// Renderização Tabela / Timeline / Memória
// ============================================
function renderTabela(resultado, tipoPeriodo) {
  const container = document.getElementById("tabela-content");
  const config = tabs[currentTab];
  let html = "";

  // Resumo
  if (resultado.paybackTotal !== undefined) {
    const tempoExato = formatarTempoPayback(
      resultado.paybackTotal,
      tipoPeriodo,
    );
    html += `<div class="resumo-box">
            <div class="resumo-item">
                <div class="label">Payback Exato</div>
                <div class="value" style="font-size: 18px;">${tempoExato}</div>
                <div style="font-size: 12px; color: #64748b; margin-top: 4px;">(${resultado.paybackTotal !== null ? resultado.paybackTotal.toFixed(2) + " períodos decimais" : "-"})</div>
            </div>
        </div>`;
  }
  if (resultado.vpl !== undefined) {
    html += `<div class="resumo-box"><div class="resumo-item"><div class="label">VPL</div><div class="value" style="color: ${resultado.vpl >= 0 ? "var(--success)" : "var(--danger)"}">${formatMoney(resultado.vpl)}</div></div></div>`;
  }
  if (resultado.tir !== undefined && resultado.icc === undefined) {
    html += `<div class="resumo-box"><div class="resumo-item"><div class="label">TIR</div><div class="value">${formatNumber(resultado.tir, 4)}%</div></div></div>`;
  }
  if (resultado.icc !== undefined) {
    html += `<div class="resumo-box"><div class="resumo-item"><div class="label">ICC</div><div class="value">${formatNumber(resultado.icc, 4)}%</div></div><div class="resumo-item"><div class="label">TIR</div><div class="value">${formatNumber(resultado.tir, 4)}%</div></div></div>`;
  }

  if (config.colunas.length > 0 && resultado.tabela) {
    html += "<table><thead><tr>";
    config.colunas.forEach((col) => {
      html += `<th>${col}</th>`;
    });
    html += "</tr></thead><tbody>";

    resultado.tabela.forEach((row) => {
      // Define a classe com base no período (0 = Vermelho/Investimento, Outros = Azul)
      let cls = "";
      if (row.n === 0) {
        cls = "row-investimento";
      } else if (row.highlight) {
        cls = "highlight"; // Mantém o destaque verde do payback se houver
      } else {
        cls = "row-parcela";
      }

      html += `<tr class="${cls}">`;

      config.colunas.forEach((col) => {
        let val = "";
        switch (col.toLowerCase()) {
          case "n":
            val = row.n;
            break;
          case "ii":
          case "investimento inicial":
            val =
              row.ii !== "" && row.ii !== undefined ? formatMoney(row.ii) : "-";
            break;
          case "valor da parcela total (r$)":
          case "parcela":
            val =
              row.n === 0
                ? formatMoney(investimento || row.fluxo || 0)
                : formatMoney(row.parcela);
            break;
          case "juros embutidos (r$)":
          case "juros":
            val = row.n === 0 ? "-" : formatMoney(row.juros);
            break;
          case "amortização da dívida (r$)":
          case "amortização":
            val = row.n === 0 ? "-" : formatMoney(row.amortizacao);
            break;
          case "saldo devedor restante (r$)":
          case "saldo":
            val = formatMoney(row.saldo);
            break;
          case "fluxo de retorno":
          case "fluxo":
            val = formatMoney(row.fluxo);
            break;
          case "valor a recuperar":
            val = formatMoney(row.recuperar);
            break;
          case "fator":
            val =
              typeof row.fator === "number"
                ? formatNumber(row.fator, 6)
                : row.fator;
            break;
          case "vp":
            val = formatMoney(row.vp);
            break;
          default:
            val =
              row[col.toLowerCase()] !== undefined
                ? row[col.toLowerCase()]
                : "";
        }
        html += `<td>${val}</td>`;
      });
      html += "</tr>";
    });
  }

  container.innerHTML = html;
}

function renderFluxoCaixa(resultado, tipoPeriodo) {
  const timeline = document.getElementById("timeline");
  timeline.innerHTML = "";

  let dados = [];

  // Pega o valor digitado no campo de investimento (se estiver vazio, assume 0)
  const valorInvestimento =
    parseFloat(document.getElementById("investimento").value) || 0;

  // 1. Adiciona manualmente o Período 0 (Início / Investimento) se houver valor
  if (valorInvestimento > 0) {
    dados.push({
      label: "Início",
      value: -valorInvestimento, // Fica negativo (vermelho) indicando saída de caixa
    });
  }

  // 2. Adiciona o restante dos fluxos (Período 1 em diante)
  if (resultado.tabela && resultado.tabela.length > 0) {
    resultado.tabela.forEach((row) => {
      if (row.n > 0) {
        let val = 0;
        if (row.fluxo !== undefined) {
          val = row.fluxo;
        } else if (row.parcela !== undefined) {
          val = -row.parcela;
        }
        dados.push({
          label: `Per. ${row.n}`,
          value: val,
        });
      }
    });
  }

  const totalSoma = dados.reduce((acc, curr) => acc + Math.abs(curr.value), 0);
  if (dados.length === 0 || totalSoma === 0 || isNaN(totalSoma)) {
    timeline.innerHTML =
      '<p style="color: #64748b; font-size: 14px; width: 100%; text-align: center; padding-bottom: 20px;">Preencha os valores para ver o gráfico.</p>';
    return;
  }

  const maxVal = Math.max(...dados.map((d) => Math.abs(d.value))) || 1;
  const maxHeight = 140;

  dados.forEach((d, i) => {
    const item = document.createElement("div");
    item.className = "timeline-item";

    const bar = document.createElement("div");
    bar.className = `timeline-bar ${d.value < 0 ? "negative" : "positive"}`;

    const height = (Math.abs(d.value) / maxVal) * maxHeight;
    bar.style.height = "0px";

    const valueLabel = document.createElement("div");
    valueLabel.className = "timeline-value";
    valueLabel.textContent = formatMoney(Math.abs(d.value));
    bar.appendChild(valueLabel);

    const label = document.createElement("div");
    label.className = "timeline-label";
    label.textContent = d.label;

    item.appendChild(bar);
    item.appendChild(label);
    timeline.appendChild(item);

    setTimeout(
      () => {
        bar.style.height = `${height}px`;
      },
      i * 100 + 50,
    );
  });
}

function renderMemoria(memoria, tipoPeriodo) {
  const display = document
    .getElementById("hp-display")
    ?.querySelector(".hp-screen");
  const steps = document.getElementById("memoria-steps");

  if (display && memoria.length > 0) {
    display.textContent = memoria[memoria.length - 1].result || "0,00";
  }

  if (steps) {
    steps.innerHTML = memoria
      .map(
        (m, i) =>
          `<div class="step">${i + 1}. ${m.desc} <span class="step-result">→ ${m.result}</span></div>`,
      )
      .join("");
  }
}

// Memórias de cálculo HP-12C
function memoriaPayback(investimento, fluxos, resultado) {
  let mem = [
    { desc: `Investimento Inicial`, result: formatMoney(investimento) },
  ];
  let acumulado = -investimento;
  fluxos.forEach((f, i) => {
    acumulado += f;
    mem.push({
      desc: `Período ${i + 1}: ${formatMoney(f)} | Acumulado`,
      result: formatMoney(acumulado),
    });
  });
  if (resultado.paybackTotal !== null) {
    mem.push({
      desc: `Payback Total`,
      result: formatNumber(resultado.paybackTotal, 2) + " períodos",
    });
  }
  return mem;
}

function memoriaVPL(investimento, fluxos, taxa, resultado) {
  let mem = [
    { desc: `f CLEAR REG`, result: "0,00" },
    {
      desc: `CHS ${formatMoney(investimento)} g CF₀`,
      result: formatMoney(-investimento),
    },
  ];
  fluxos.forEach((f, i) =>
    mem.push({ desc: `${formatMoney(f)} g CFⱼ`, result: formatMoney(f) }),
  );
  mem.push({ desc: `${taxa} i`, result: taxa + "%" });
  mem.push({ desc: `f NPV`, result: formatMoney(resultado.vpl) });
  return mem;
}

function memoriaTIR(investimento, fluxos, resultado) {
  let mem = [
    { desc: `f CLEAR REG`, result: "0,00" },
    {
      desc: `CHS ${formatMoney(investimento)} g CF₀`,
      result: formatMoney(-investimento),
    },
  ];
  fluxos.forEach((f, i) =>
    mem.push({ desc: `${formatMoney(f)} g CFⱼ`, result: formatMoney(f) }),
  );
  mem.push({ desc: `f IRR`, result: formatNumber(resultado.tir, 4) + "%" });
  return mem;
}

function memoriaICC(investimento, fluxos, taxa, resultado) {
  return [
    { desc: `TIR`, result: formatNumber(resultado.tir, 4) + "%" },
    { desc: `ICC`, result: formatNumber(resultado.icc, 4) + "%" },
  ];
}

function memoriaSAA(principal, taxa, periodos, resultado) {
  return [
    { desc: `Total de Juros`, result: formatMoney(resultado.jurosTotal) },
  ];
}
function memoriaSAF(principal, taxa, periodos, resultado) {
  return [{ desc: `Total Pago`, result: formatMoney(resultado.totalPago) }];
}
function memoriaPrice(principal, taxa, periodos, resultado) {
  return [{ desc: `Parcela (PMT)`, result: formatMoney(resultado.parcela) }];
}
function memoriaSAC(principal, taxa, periodos, resultado) {
  return memoriaSAF(principal, taxa, periodos, resultado);
}
