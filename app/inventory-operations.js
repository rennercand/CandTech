"use client";

import { useEffect, useMemo, useState } from "react";
import { INVENTORY_TEMPLATE, matchInventoryEntry, parseInventoryFile, parseInventoryText } from "@/lib/inventory-import";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const emptyVariant = () => ({ name: "Padrão", sku: "", quantity: "", minimumQuantity: "", unitCost: "", salePrice: "", location: "", lotCode: "", expiresOn: "" });
const emptyLine = () => ({ variantId: "", quantity: "", unitCost: "", unitPrice: "", lotCode: "", expiresOn: "" });

function Label({ title, children, hint }) {
  return <label className="inventory-label"><span>{title}</span>{children}{hint && <small>{hint}</small>}</label>;
}

function variantRows(inventory) {
  return (inventory?.products || []).flatMap((product) => product.variants.map((variant) => ({ ...variant, product })));
}

function ProductForm({ onSave, initial, busy }) {
  const [form, setForm] = useState(initial || { name: "", category: "", unit: "un", variants: [emptyVariant()] });
  const [axisA, setAxisA] = useState("");
  const [axisB, setAxisB] = useState("");
  useEffect(() => { if (initial) setForm(initial); }, [initial]);
  function updateVariant(index, field, value) {
    setForm((current) => ({ ...current, variants: current.variants.map((variant, row) => row === index ? { ...variant, [field]: value } : variant) }));
  }
  function generate() {
    const first = axisA.split(",").map((item) => item.trim()).filter(Boolean);
    const second = axisB.split(",").map((item) => item.trim()).filter(Boolean);
    if (!first.length) return;
    const combinations = second.length ? first.flatMap((a) => second.map((b) => `${a} · ${b}`)) : first;
    const base = (form.name || "PROD").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/gi, "").slice(0, 5).toUpperCase() || "PROD";
    setForm((current) => ({ ...current, variants: combinations.map((name, index) => ({ ...emptyVariant(), name, sku: `${base}-${String(index + 1).padStart(3, "0")}` })) }));
  }
  return <form className="inventory-form-stack" onSubmit={async (event) => { event.preventDefault(); const saved = await onSave(form); if (saved) { setForm({ name: "", category: "", unit: "un", variants: [emptyVariant()] }); setAxisA(""); setAxisB(""); } }}>
    <div className="inventory-form-grid product-basics">
      <Label title="Produto"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex.: Pelúcia" /></Label>
      <Label title="Categoria"><input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Ex.: Presentes" /></Label>
      <Label title="Unidade"><select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}><option value="un">Unidade</option><option value="kg">Quilograma</option><option value="g">Grama</option><option value="l">Litro</option><option value="ml">Mililitro</option><option value="cx">Caixa</option></select></Label>
    </div>
    <details className="variant-generator"><summary>Gerar várias variações automaticamente</summary><p>Use para modelo, sabor, tamanho, cor ou armazenamento. O SKU sugerido poderá ser revisado.</p><div className="inventory-form-grid"><Label title="Primeiro grupo" hint="Ex.: Cachorro, Gato, Urso"><input value={axisA} onChange={(e) => setAxisA(e.target.value)} /></Label><Label title="Segundo grupo (opcional)" hint="Ex.: P, M, G"><input value={axisB} onChange={(e) => setAxisB(e.target.value)} /></Label><button type="button" className="secondary-button" onClick={generate}>Gerar combinações</button></div></details>
    <div className="inventory-edit-table">
      <div className="inventory-table-head"><span>Variação</span><span>SKU único</span><span>Saldo inicial</span><span>Mínimo</span><span>Custo</span><span>Preço</span><span>Local</span><span></span></div>
      {form.variants.map((variant, index) => <div className="inventory-table-row" key={index}>
        <input aria-label="Variação" required value={variant.name} onChange={(e) => updateVariant(index, "name", e.target.value)} />
        <input aria-label="SKU" required value={variant.sku} onChange={(e) => updateVariant(index, "sku", e.target.value.toUpperCase())} />
        <input aria-label="Saldo inicial" type="number" min="0" step="0.001" value={variant.quantity} onChange={(e) => updateVariant(index, "quantity", e.target.value)} />
        <input aria-label="Estoque mínimo" type="number" min="0" step="0.001" value={variant.minimumQuantity} onChange={(e) => updateVariant(index, "minimumQuantity", e.target.value)} />
        <input aria-label="Custo" type="number" min="0" step="0.01" value={variant.unitCost} onChange={(e) => updateVariant(index, "unitCost", e.target.value)} />
        <input aria-label="Preço" type="number" min="0" step="0.01" value={variant.salePrice} onChange={(e) => updateVariant(index, "salePrice", e.target.value)} />
        <input aria-label="Localização" value={variant.location} onChange={(e) => updateVariant(index, "location", e.target.value)} />
        <button type="button" className="remove-row" aria-label="Remover variação" disabled={form.variants.length === 1} onClick={() => setForm({ ...form, variants: form.variants.filter((_, row) => row !== index) })}>×</button>
      </div>)}
    </div>
    <div className="module-actions"><button type="button" className="secondary-button" onClick={() => setForm({ ...form, variants: [...form.variants, emptyVariant()] })}>+ Variação</button><button className="primary-button" disabled={busy}>{busy ? "Salvando…" : "Cadastrar produto"}</button></div>
  </form>;
}

function EntryForm({ variants, onSave, busy }) {
  const [header, setHeader] = useState({ supplier: "", reference: "", note: "" });
  const [lines, setLines] = useState([emptyLine()]);
  function update(index, field, value) { setLines((current) => current.map((line, row) => row === index ? { ...line, [field]: value } : line)); }
  return <form className="inventory-form-stack" onSubmit={(event) => { event.preventDefault(); onSave({ ...header, lines }).then((ok) => { if (ok) { setHeader({ supplier: "", reference: "", note: "" }); setLines([emptyLine()]); } }); }}>
    <div className="inventory-form-grid"><Label title="Fornecedor"><input value={header.supplier} onChange={(e) => setHeader({ ...header, supplier: e.target.value })} /></Label><Label title="Nota ou referência"><input value={header.reference} onChange={(e) => setHeader({ ...header, reference: e.target.value })} /></Label><Label title="Observação"><input value={header.note} onChange={(e) => setHeader({ ...header, note: e.target.value })} /></Label></div>
    <div className="inventory-edit-table entry-lines"><div className="inventory-table-head"><span>Produto</span><span>Quantidade</span><span>Custo</span><span>Lote</span><span>Validade</span><span></span></div>{lines.map((line, index) => <div className="inventory-table-row" key={index}>
      <select required value={line.variantId} onChange={(e) => { const selected = variants.find((item) => item.id === e.target.value); update(index, "variantId", e.target.value); if (selected) update(index, "unitCost", selected.unitCost); }}><option value="">Selecione</option>{variants.map((item) => <option key={item.id} value={item.id}>{item.product.name} · {item.name} · {item.sku}</option>)}</select>
      <input required aria-label="Quantidade" type="number" min="0.001" step="0.001" value={line.quantity} onChange={(e) => update(index, "quantity", e.target.value)} />
      <input aria-label="Custo unitário" type="number" min="0" step="0.01" value={line.unitCost} onChange={(e) => update(index, "unitCost", e.target.value)} />
      <input aria-label="Lote" value={line.lotCode} onChange={(e) => update(index, "lotCode", e.target.value)} />
      <input aria-label="Validade" type="date" value={line.expiresOn} onChange={(e) => update(index, "expiresOn", e.target.value)} />
      <button type="button" className="remove-row" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, row) => row !== index))}>×</button>
    </div>)}</div>
    <div className="module-actions"><button type="button" className="secondary-button" onClick={() => setLines((current) => [...current, emptyLine()])}>+ Item</button><button className="primary-button" disabled={busy || !variants.length}>{busy ? "Registrando…" : "Confirmar entrada"}</button></div>
  </form>;
}

function OrderForm({ variants, onSave, busy }) {
  const [form, setForm] = useState({ type: "sale", reference: "", partner: "", lines: [emptyLine()] });
  const total = form.lines.reduce((sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0), 0);
  function updateLine(index, field, value) { setForm((current) => ({ ...current, lines: current.lines.map((line, row) => row === index ? { ...line, [field]: value } : line) })); }
  return <form className="inventory-form-stack" onSubmit={(event) => { event.preventDefault(); onSave(form).then((ok) => { if (ok) setForm({ type: "sale", reference: "", partner: "", lines: [emptyLine()] }); }); }}>
    <div className="inventory-form-grid"><Label title="Operação"><select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="sale">Venda</option><option value="purchase">Compra</option></select></Label><Label title="Pedido ou referência"><input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></Label><Label title={form.type === "sale" ? "Cliente" : "Fornecedor"}><input value={form.partner} onChange={(e) => setForm({ ...form, partner: e.target.value })} /></Label></div>
    <div className="inventory-edit-table order-lines"><div className="inventory-table-head"><span>Produto</span><span>Saldo</span><span>Quantidade</span><span>Preço unitário</span><span>Total</span><span></span></div>{form.lines.map((line, index) => { const selected = variants.find((item) => item.id === line.variantId); return <div className="inventory-table-row" key={index}>
      <select required value={line.variantId} onChange={(e) => { const item = variants.find((variant) => variant.id === e.target.value); updateLine(index, "variantId", e.target.value); if (item) updateLine(index, "unitPrice", form.type === "sale" ? item.salePrice : item.unitCost); }}><option value="">Selecione</option>{variants.map((item) => <option key={item.id} value={item.id}>{item.product.name} · {item.name} · {item.sku}</option>)}</select>
      <span>{selected ? `${selected.quantity} ${selected.product.unit}` : "—"}</span>
      <input required type="number" min="0.001" step="0.001" value={line.quantity} onChange={(e) => updateLine(index, "quantity", e.target.value)} />
      <input required type="number" min="0" step="0.01" value={line.unitPrice} onChange={(e) => updateLine(index, "unitPrice", e.target.value)} />
      <strong>{money.format((Number(line.quantity) || 0) * (Number(line.unitPrice) || 0))}</strong>
      <button type="button" className="remove-row" disabled={form.lines.length === 1} onClick={() => setForm({ ...form, lines: form.lines.filter((_, row) => row !== index) })}>×</button>
    </div>; })}</div>
    <div className="order-total"><span>Total do pedido</span><strong>{money.format(total)}</strong></div><div className="module-actions"><button type="button" className="secondary-button" onClick={() => setForm((current) => ({ ...current, lines: [...current.lines, emptyLine()] }))}>+ Produto</button><button className="primary-button" disabled={busy || !variants.length}>{busy ? "Concluindo…" : `Concluir ${form.type === "sale" ? "venda" : "compra"}`}</button></div>
  </form>;
}

function ImportPanel({ onImport, onEntryImport, variants, busy }) {
  const [mode, setMode] = useState("products");
  const [pasted, setPasted] = useState(""); const [preview, setPreview] = useState(null); const [error, setError] = useState("");
  const [entryHeader, setEntryHeader] = useState({ supplier: "", reference: "" });
  const matchedEntry = useMemo(() => preview && mode === "entry" ? matchInventoryEntry(preview, variants) : null, [preview, variants, mode]);
  function show(result) { setPreview(result); setError(result.errors?.length ? result.errors.slice(0, 8).join(" ") : ""); }
  async function fileChanged(file) { if (!file) return; try { show(await parseInventoryFile(file)); } catch (cause) { setPreview(null); setError(cause.message); } }
  function parsePaste() { try { show(parseInventoryText(pasted)); } catch (cause) { setPreview(null); setError(cause.message); } }
  function template() { const blob = new Blob(["\uFEFF", INVENTORY_TEMPLATE], { type: "text/csv;charset=utf-8" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "modelo-estoque-candtech.csv"; link.click(); URL.revokeObjectURL(link.href); }
  const validationErrors = mode === "entry" ? matchedEntry?.errors || [] : preview?.errors || [];
  return <div className="inventory-form-stack"><div className="import-mode" role="group" aria-label="Objetivo da planilha"><button type="button" className={mode === "products" ? "active" : ""} onClick={() => { setMode("products"); setPreview(null); setError(""); }}><strong>Cadastrar produtos novos</strong><span>Cria os SKUs e registra o saldo inicial</span></button><button type="button" className={mode === "entry" ? "active" : ""} onClick={() => { setMode("entry"); setPreview(null); setError(""); }}><strong>Dar entrada em SKUs existentes</strong><span>Soma somente a quantidade recebida</span></button></div>
    {mode === "entry" && <div className="inventory-message import-warning"><strong>Atenção:</strong> na coluna Quantidade, informe apenas o que chegou agora. O sistema somará ao saldo atual; não cole o saldo total.</div>}
    {mode === "entry" && <div className="inventory-form-grid"><Label title="Fornecedor"><input value={entryHeader.supplier} onChange={(event) => setEntryHeader({ ...entryHeader, supplier: event.target.value })} /></Label><Label title="Nota ou referência"><input value={entryHeader.reference} onChange={(event) => setEntryHeader({ ...entryHeader, reference: event.target.value })} /></Label></div>}
    <div className="import-options"><label className="file-drop"><strong>Selecionar planilha</strong><span>CSV, TSV, TXT ou XLSX</span><input type="file" accept=".csv,.tsv,.txt,.xlsx" onChange={(e) => fileChanged(e.target.files?.[0])} /></label><div><strong>Ou cole linhas do Excel</strong><textarea rows="7" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={INVENTORY_TEMPLATE} /><button type="button" className="secondary-button" onClick={parsePaste}>Preparar prévia</button></div></div>
    <button type="button" className="text-button" onClick={template}>Baixar modelo preenchido</button>
    {error && <div className="inventory-message error">{error}</div>}
    {matchedEntry?.errors.length > 0 && <div className="inventory-message error">{matchedEntry.errors.slice(0, 8).join(" ")}</div>}
    {preview && <div className="import-preview"><strong>Prévia antes de gravar</strong><span>{mode === "entry" ? `${matchedEntry?.lines.length || 0} SKUs encontrados no cadastro` : `${preview.variantCount} SKUs em ${preview.products.length} produtos`}</span><small>Nenhuma linha será gravada até sua confirmação.</small><button className="primary-button" disabled={busy || validationErrors.length > 0 || (mode === "entry" && !matchedEntry?.lines.length)} onClick={() => mode === "entry" ? onEntryImport(matchedEntry.lines, entryHeader) : onImport(preview.products)}>{busy ? "Importando…" : mode === "entry" ? "Confirmar entrada" : "Confirmar cadastro"}</button></div>}
  </div>;
}

export default function InventoryOperations({ initialSection = "overview", onSnapshot, canExport = false, canUseDrive = false, driveStatus }) {
  const [inventory, setInventory] = useState({ products: [], batches: [], orders: [], lots: [] });
  const [section, setSection] = useState(initialSection); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(""); const [error, setError] = useState(false); const [duplicate, setDuplicate] = useState(null);
  const [driveFile, setDriveFile] = useState(null);
  const [productQuery, setProductQuery] = useState("");
  const variants = useMemo(() => variantRows(inventory), [inventory]);
  const filteredProducts = useMemo(() => {
    const query = productQuery.trim().toLowerCase();
    if (!query) return inventory.products;
    return inventory.products.filter((product) => [product.name, product.category, ...product.variants.flatMap((variant) => [variant.name, variant.sku])]
      .some((value) => String(value || "").toLowerCase().includes(query)));
  }, [inventory.products, productQuery]);
  const totalUnits = variants.reduce((sum, item) => sum + item.quantity, 0);
  const totalValue = variants.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
  const low = variants.filter((item) => item.quantity <= item.minimumQuantity);
  const categoryValues = useMemo(() => {
    const totals = new Map();
    variants.forEach((item) => {
      const category = item.product.category || "Sem categoria";
      totals.set(category, (totals.get(category) || 0) + item.quantity * item.unitCost);
    });
    return [...totals.entries()].map(([category, value]) => ({ category, value })).sort((a, b) => b.value - a.value).slice(0, 6);
  }, [variants]);
  const datedLots = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return (inventory.lots || []).filter((lot) => lot.expires_on).map((lot) => {
      const expires = new Date(`${String(lot.expires_on).slice(0, 10)}T00:00:00`);
      return { ...lot, days: Math.ceil((expires.getTime() - today.getTime()) / 86_400_000) };
    }).filter((lot) => lot.days <= 30).sort((a, b) => a.days - b.days);
  }, [inventory.lots]);
  const largestCategoryValue = categoryValues[0]?.value || 1;
  useEffect(() => { setSection(initialSection); }, [initialSection]);
  useEffect(() => { fetch("/api/inventory", { cache: "no-store" }).then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error); setInventory(body.inventory); }).catch((cause) => { setError(true); setMessage(cause.message || "Não foi possível carregar o estoque."); }).finally(() => setLoading(false)); }, []);
  useEffect(() => { if (!onSnapshot || loading) return; onSnapshot({ products: variants.map((item) => ({ id: item.id, name: `${item.product.name}${item.name === "Padrão" ? "" : ` · ${item.name}`}`, sku: item.sku, quantity: item.quantity, minimum: item.minimumQuantity, unitCost: item.unitCost, location: item.location, lockedAt: "relational" })) }); }, [inventory, loading]);
  useEffect(() => {
    if (loading || !canUseDrive || sessionStorage.getItem("candtech_pending_inventory_drive") !== "1") return;
    sessionStorage.removeItem("candtech_pending_inventory_drive");
    sendInventoryToDrive();
  }, [loading, canUseDrive]);
  async function post(payload, success) { setBusy(true); setMessage(""); try { const response = await fetch("/api/inventory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); const body = await response.json(); if (!response.ok) throw new Error(body.error); setInventory(body.inventory); setError(false); setMessage(success); return true; } catch (cause) { setError(true); setMessage(cause.message || "Não foi possível concluir."); return false; } finally { setBusy(false); } }
  function downloadInventory(format) {
    const link = document.createElement("a");
    link.href = `/api/inventory/export?format=${format}`;
    link.download = "";
    document.body.appendChild(link); link.click(); link.remove();
  }
  async function sendInventoryToDrive() {
    setBusy(true); setMessage("Enviando relatório do estoque ao Google Drive…"); setError(false); setDriveFile(null);
    try {
      const response = await fetch("/api/inventory/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = await response.json();
      if (body.needsConnection) { window.location.assign("/api/google-drive/connect?returnTo=inventory"); return; }
      if (!response.ok) throw new Error(body.error);
      setDriveFile(body.file); setMessage(`Arquivo ${body.file.name} enviado ao Google Drive.`);
    } catch (cause) { setError(true); setMessage(cause.message || "Não foi possível enviar ao Google Drive."); }
    finally { setBusy(false); }
  }
  const sections = [["overview", "Visão geral"], ["entry", "Entrada rápida"], ["products", "Produtos e variações"], ["import", "Importar planilha"], ["orders", "Pedidos"], ["lots", "Lotes e validades"], ["history", "Movimentações"], ["guide", "Como operar"]];
  if (loading) return <section className="panel"><p>Carregando estoque organizado…</p></section>;
  return <div className="business-stack relational-inventory">
    <section className="panel inventory-command-bar"><div><span className="eyebrow">ESTOQUE RELACIONAL</span><h2>Operação guiada</h2><p>Cadastre uma vez e movimente por entradas, compras e vendas. Cada alteração fica registrada.</p></div><nav aria-label="Áreas do estoque">{sections.map(([id, label]) => <button key={id} className={section === id ? "active" : ""} onClick={() => setSection(id)}>{label}</button>)}</nav></section>
    {message && <div className={error ? "inventory-message error" : "inventory-message"}>{message}</div>}
    {section === "overview" && <>
      <div className="summary-grid"><article><span>Produtos</span><strong>{inventory.products.length}</strong><small>{variants.length} SKUs</small></article><article><span>Unidades em estoque</span><strong>{totalUnits}</strong><small>Somadas em todas as variações</small></article><article><span>Valor pelo custo</span><strong>{money.format(totalValue)}</strong><small>Estimativa operacional</small></article><article><span>Alertas</span><strong>{low.length + datedLots.length}</strong><small>Estoque baixo ou validade próxima</small></article></div>
      <section className="panel"><div className="panel-heading"><div><span className="eyebrow">PRÓXIMA AÇÃO</span><h2>Atalhos para o funcionário</h2></div></div><div className="inventory-shortcuts"><button onClick={() => setSection("entry")}><strong>Mercadoria chegou</strong><span>Registrar entrada de vários itens</span></button><button onClick={() => setSection("orders")}><strong>Venda ou compra</strong><span>Montar pedido com vários produtos</span></button><button onClick={() => setSection("import")}><strong>Usar planilha</strong><span>Cadastrar produtos ou dar entrada por SKU</span></button></div></section>
      <div className="inventory-insights-grid">
        <section className="panel"><div className="panel-heading"><div><span className="eyebrow">VALOR PARADO</span><h2>Estoque por categoria</h2><p>Mostra onde está concentrado o dinheiro investido em mercadorias.</p></div></div>{categoryValues.length ? <div className="inventory-value-chart">{categoryValues.map((item) => <div key={item.category}><span><strong>{item.category}</strong><small>{money.format(item.value)}</small></span><i><b style={{ width: `${Math.max(3, item.value / largestCategoryValue * 100)}%` }} /></i></div>)}</div> : <p className="empty-state">Cadastre produtos com custo para visualizar o gráfico.</p>}</section>
        {canExport && <section className="panel inventory-report-panel"><div className="panel-heading"><div><span className="eyebrow">RELATÓRIO</span><h2>Levar ou compartilhar os dados</h2><p>O CSV serve para conferência e reimportação; o Excel já sai organizado para apresentação.</p></div></div><div className="module-actions"><button className="secondary-button" onClick={() => downloadInventory("csv")}>Baixar CSV</button><button className="secondary-button" onClick={() => downloadInventory("xlsx")}>Baixar Excel</button>{canUseDrive && driveStatus?.configured && <button className="primary-button" disabled={busy} onClick={sendInventoryToDrive}>{busy ? "Enviando…" : "Enviar ao Google Drive"}</button>}</div>{canUseDrive && driveStatus && !driveStatus.loading && !driveStatus.configured && <small>O administrador ainda precisa configurar as credenciais do Google Drive no servidor.</small>}{driveFile?.webViewLink && <a className="drive-file-link" href={driveFile.webViewLink} target="_blank" rel="noreferrer">Abrir {driveFile.name} no Google Drive</a>}</section>}
      </div>
      {datedLots.length > 0 && <section className="panel expiry-alert-panel"><div className="panel-heading"><div><span className="eyebrow">VALIDADE</span><h2>Lotes vencidos ou próximos de vencer</h2><p>Alerta de conferência: a lista registra o que foi recebido e ainda não calcula o saldo individual de cada lote.</p></div><button className="secondary-button compact" onClick={() => setSection("lots")}>Ver todos os lotes</button></div><div className="stock-alert-list">{datedLots.map((lot) => <div key={`${lot.variant_id}-${lot.lot_code}-${lot.expires_on}`}><strong>{lot.product_name} · {lot.variant_name}</strong><span className={lot.days < 0 ? "expiry-overdue" : ""}>{lot.days < 0 ? `Venceu há ${Math.abs(lot.days)} dia(s)` : lot.days === 0 ? "Vence hoje" : `Vence em ${lot.days} dia(s)`}</span></div>)}</div></section>}
      {low.length > 0 && <section className="panel"><div className="panel-heading"><div><span className="eyebrow">ATENÇÃO</span><h2>Estoque baixo</h2></div></div><div className="stock-alert-list">{low.map((item) => <div key={item.id}><strong>{item.product.name} · {item.name}</strong><span>{item.quantity} {item.product.unit} · mínimo {item.minimumQuantity}</span></div>)}</div></section>}
    </>}
    {section === "products" && <><section className="panel"><div className="panel-heading"><div><span className="eyebrow">CADASTRO</span><h2>Novo produto e variações</h2><p>Uma cor, tamanho, sabor ou modelo deve possuir SKU próprio.</p></div></div><ProductForm initial={duplicate} busy={busy} onSave={async (product) => { const ok = await post({ action: "create-products", products: [product] }, "Produto cadastrado com saldo inicial auditado."); if (ok) setDuplicate(null); return ok; }} /></section><section className="panel"><div className="panel-heading"><div><span className="eyebrow">CATÁLOGO</span><h2>{inventory.products.length} produtos cadastrados</h2></div></div><div className="inventory-catalog-search"><Label title="Buscar no catálogo"><input value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="Produto, categoria, variação ou SKU" /></Label></div><div className="product-catalog">{filteredProducts.map((product) => <article key={product.id}><header><div><strong>{product.name}</strong><small>{product.category || "Sem categoria"} · {product.unit}</small></div><button className="text-button" onClick={() => { setDuplicate({ name: `${product.name} cópia`, category: product.category, unit: product.unit, variants: product.variants.map((variant) => ({ ...emptyVariant(), ...variant, quantity: 0, sku: `${variant.sku}-COPIA` })) }); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Duplicar</button></header>{product.variants.map((variant) => <div className="catalog-variant" key={variant.id}><span><strong>{variant.name}</strong><small>{variant.sku}</small></span><span>{variant.quantity} {product.unit}</span><span>{money.format(variant.salePrice)}</span></div>)}</article>)}</div>{!filteredProducts.length && <p className="empty-state">Nenhum produto corresponde à busca.</p>}</section></>}
    {section === "entry" && <section className="panel"><div className="panel-heading"><div><span className="eyebrow">RECEBIMENTO</span><h2>Entrada rápida de mercadorias</h2><p>Informe vários produtos e confirme uma única vez. Lote e validade são opcionais para varejo e recomendados para alimentos.</p></div></div><EntryForm variants={variants} busy={busy} onSave={(data) => post({ action: "entry", ...data }, "Entrada registrada. Os saldos e custos foram atualizados.")} /></section>}
    {section === "import" && <section className="panel"><div className="panel-heading"><div><span className="eyebrow">PLANILHA ASSISTIDA</span><h2>Cadastro ou entrada em lote</h2><p>Escolha primeiro o objetivo e revise a prévia. O sistema confere SKUs antes de alterar qualquer saldo.</p></div></div><ImportPanel variants={variants} busy={busy} onImport={(products) => post({ action: "import-products", products, reference: "Importação por planilha" }, "Produtos importados e saldo inicial registrado.")} onEntryImport={(lines, header) => post({ action: "entry", lines, ...header, note: "Entrada conferida por planilha" }, "Entrada por planilha registrada nos SKUs existentes.")} /></section>}
    {section === "orders" && <><section className="panel"><div className="panel-heading"><div><span className="eyebrow">COMERCIAL</span><h2>Pedido com vários produtos</h2><p>A venda reduz o estoque; a compra aumenta. Se houver erro, desfaça a movimentação no histórico.</p></div></div><OrderForm variants={variants} busy={busy} onSave={(data) => post({ action: "order", ...data }, `${data.type === "sale" ? "Venda" : "Compra"} concluída e estoque atualizado.`)} /></section>{inventory.orders.length > 0 && <section className="panel"><div className="panel-heading"><div><span className="eyebrow">RECENTES</span><h2>Últimos pedidos</h2></div></div><div className="batch-list">{inventory.orders.map((order) => <div key={order.id}><span><strong>{order.type === "sale" ? "Venda" : "Compra"} · {order.reference || "Sem referência"}</strong><small>{order.partner || "Sem cliente/fornecedor"} · {new Date(order.created_at).toLocaleString("pt-BR")}</small></span><strong>{money.format(order.total)}</strong></div>)}</div></section>}</>}
    {section === "lots" && <section className="panel"><div className="panel-heading"><div><span className="eyebrow">RASTREABILIDADE</span><h2>Lotes e validades recebidos</h2><p>Esta lista mostra a quantidade recebida em cada lote. Ela ainda não representa o saldo do lote, pois a baixa automática por FEFO está planejada para a próxima evolução.</p></div></div><div className="batch-list">{(inventory.lots || []).map((lot) => <div key={`${lot.variant_id}-${lot.lot_code}-${lot.expires_on || "sem-data"}`}><span><strong>{lot.product_name} · {lot.variant_name}</strong><small>{lot.sku} · lote {lot.lot_code || "não informado"}</small></span><span><strong>{lot.received_quantity} recebidas</strong><small>{lot.expires_on ? `Validade ${new Date(`${lot.expires_on}T12:00:00`).toLocaleDateString("pt-BR")}` : "Sem validade informada"}</small></span></div>)}</div>{!(inventory.lots || []).length && <p className="empty-state">Nenhum lote ou validade registrado nas entradas.</p>}</section>}
    {section === "history" && <section className="panel"><div className="panel-heading"><div><span className="eyebrow">AUDITORIA</span><h2>Movimentações recentes</h2><p>Desfazer cria uma movimentação inversa; o registro original permanece para conferência.</p></div></div><div className="batch-list">{inventory.batches.map((batch) => <div key={batch.id}><span><strong>{({ entry: "Entrada", import: "Importação", sale: "Venda", purchase: "Compra", reversal: "Desfazimento", adjustment: "Ajuste" })[batch.kind] || batch.kind} · {batch.reference || "Sem referência"}</strong><small>{batch.item_count} itens · {batch.total_units} unidades · {new Date(batch.created_at).toLocaleString("pt-BR")}</small></span><span className={`batch-status ${batch.status}`}>{batch.status === "reversed" ? "Desfeita" : "Ativa"}</span>{batch.status === "active" && batch.kind !== "reversal" && <button className="secondary-button danger-button compact" disabled={busy} onClick={() => confirm("Desfazer toda esta operação? O histórico será preservado.") && post({ action: "undo-batch", batchId: batch.id }, "Operação desfeita com registro de auditoria.")}>Desfazer</button>}</div>)}</div>{!inventory.batches.length && <p className="empty-state">Nenhuma movimentação registrada.</p>}</section>}
    {section === "guide" && <section className="panel employee-guide"><div className="panel-heading"><div><span className="eyebrow">CAPACITAÇÃO</span><h2>Rotina simples para o funcionário</h2><p>Use esta sequência no treinamento. O funcionário não precisa conhecer banco de dados nem cálculos.</p></div></div><ol><li><strong>Produto novo:</strong> abra “Produtos e variações”, cadastre o nome e crie um SKU para cada modelo, cor, sabor ou tamanho.</li><li><strong>Mercadoria recebida:</strong> abra “Entrada rápida”, escolha os itens, informe quantidade e custo e confirme uma vez.</li><li><strong>Muitas mercadorias:</strong> em “Importar planilha”, escolha “Dar entrada em SKUs existentes” e informe somente a quantidade que chegou.</li><li><strong>Venda ou compra:</strong> abra “Pedidos”, adicione todos os produtos e confira o total antes de concluir.</li><li><strong>Estoque inicial grande:</strong> na planilha, escolha “Cadastrar produtos novos”, preencha o modelo e confira a prévia.</li><li><strong>Erro operacional:</strong> não altere o saldo manualmente; abra “Movimentações” e use “Desfazer”.</li><li><strong>Alimentos:</strong> sempre informe lote e validade na entrada para permitir rastreamento.</li><li><strong>Relatório:</strong> na “Visão geral”, baixe Excel/CSV ou envie ao Drive conforme sua permissão.</li></ol><div className="training-rule"><strong>Regra principal</strong><span>SKU identifica o item. Quantidade muda por entrada, compra, venda ou desfazimento — nunca por edição escondida.</span></div></section>}
  </div>;
}
