function brMoneyToNumber(value) {
  const normalized = String(value)
    .replace(/R\$/gi, "")
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");
  return Number(normalized) || 0;
}

function statementDate(value, fallbackYear = new Date().getFullYear()) {
  const match = String(value).match(/(\d{2})\/(\d{2})(?:\/(\d{2,4}))?/);
  if (!match) return "";
  const year = match[3]
    ? Number(match[3]) < 100
      ? 2000 + Number(match[3])
      : Number(match[3])
    : fallbackYear;
  return `${year}-${match[2]}-${match[1]}`;
}

export function parseStatementLines(lines) {
  // O Banco Inter escreve a data por extenso; outros bancos costumam usar dd/mm/aaaa.
  const months = {
    janeiro: "01", fevereiro: "02", marco: "03", março: "03", abril: "04", maio: "05",
    junho: "06", julho: "07", agosto: "08", setembro: "09", outubro: "10",
    novembro: "11", dezembro: "12",
  };
  const dayHeader = /(\d{1,2})\s+de\s+([a-zç]+)\s+de\s+(\d{4})/i;
  const numericDate = /\b\d{2}\/\d{2}(?:\/\d{2,4})?\b/;
  const amountPattern = /(?:-\s*)?R\$\s*(?:-\s*)?\d{1,3}(?:\.\d{3})*,\d{2}|-?\s*\d{1,3}(?:\.\d{3})*,\d{2}\s*[DC]?/gi;
  const transaction = /^(pix|aplica(?:cao|ção)|resgate|estorno|pagamento|vencimento|compra|saque|tarifa|boleto|transfer[eê]ncia)/i;
  const ignored = /saldo do dia|saldo por transa[cç][aã]o|saldo total|limite|dispon[ií]vel|resumo|total de/i;
  const imported = [];
  let currentDate = "";
  let fallbackYear = new Date().getFullYear();

  for (const rawLine of lines) {
    const line = String(rawLine).replace(/\s+/g, " ").trim();
    const header = line.match(dayHeader);

    // A data continua válida para as próximas linhas e também após uma quebra de página.
    if (header) {
      fallbackYear = Number(header[3]);
      const month = months[header[2].toLocaleLowerCase("pt-BR")];
      if (month) currentDate = `${header[3]}-${month}-${header[1].padStart(2, "0")}`;
      continue;
    }

    const inlineDate = line.match(numericDate)?.[0];
    if (inlineDate) currentDate = statementDate(inlineDate, fallbackYear);
    const searchable = inlineDate ? line.replace(inlineDate, "").trim() : line;
    if (!currentDate || ignored.test(searchable) || !transaction.test(searchable)) continue;

    const amounts = [...searchable.matchAll(amountPattern)];
    if (amounts.length === 0) continue;

    // No Inter, o primeiro valor é a movimentação e o segundo é apenas o saldo da conta.
    const rawAmount = amounts[0][0];
    const signedAmount = brMoneyToNumber(rawAmount);
    const amount = Math.abs(signedAmount);
    if (!amount) continue;

    const description = searchable.slice(0, amounts[0].index).replace(/\s+/g, " ").trim();
    imported.push({
      date: currentDate,
      category: "Não classificado",
      description: description || "Lançamento importado",
      type: signedAmount < 0 || /\bD\s*$/i.test(rawAmount.trim()) ? "saida" : "entrada",
      amount: amount.toFixed(2),
      imported: true,
    });
  }

  return imported;
}
