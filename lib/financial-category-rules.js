function normalizeText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
}

export function normalizeCategoryRules(rules = []) {
  return (Array.isArray(rules) ? rules : []).map((rule, index) => ({
    id: String(rule?.id || `rule-${index + 1}`).slice(0, 80),
    version: Math.max(1, Number.parseInt(rule?.version, 10) || 1),
    term: String(rule?.term || "").trim().slice(0, 80),
    category: String(rule?.category || "").trim().slice(0, 50),
    type: ["entrada", "saida"].includes(rule?.type) ? rule.type : "todos",
    active: rule?.active !== false,
  })).filter((rule) => rule.term && rule.category);
}

export function suggestCategory(entry = {}, rules = []) {
  const description = normalizeText(entry.description);
  const entryType = entry.type === "saida" ? "saida" : "entrada";
  const match = normalizeCategoryRules(rules).find((rule) =>
    rule.active && (rule.type === "todos" || rule.type === entryType) && description.includes(normalizeText(rule.term)),
  );
  if (!match) return null;
  return {
    category: match.category,
    ruleId: match.id,
    ruleVersion: match.version,
    explanation: `A descrição contém “${match.term}”${match.type === "todos" ? "" : ` e o tipo é ${match.type}`}.`,
  };
}
