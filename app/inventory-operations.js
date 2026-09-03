"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { INVENTORY_TEMPLATE, matchInventoryEntry, parseInventoryFile, parseInventoryText } from "@/lib/inventory-import";
import FileNameDialog, { useFileNameDialog } from "./file-name-dialog";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const localDateText = () => { const value = new Date(); return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`; };
const emptyVariant = () => ({ name: "Padrão", sku: "", quantity: "", minimumQuantity: "", restockReminderOn: "", unitCost: "", salePrice: "", location: "", lotCode: "", expiresOn: "" });
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
      <div className="inventory-table-head"><span>Variação</span><span>SKU único</span><span>Saldo inicial</span><span>Avisar em</span><span>Lembrar em</span><span>Custo</span><span>Preço</span><span>Local</span><span></span></div>
      {form.variants.map((variant, index) => <div className="inventory-table-row" key={index}>
        <input aria-label="Variação" required value={variant.name} onChange={(e) => updateVariant(index, "name", e.target.value)} />
        <input aria-label="SKU" required value={variant.sku} onChange={(e) => updateVariant(index, "sku", e.target.value.toUpperCase())} />
        <input aria-label="Saldo inicial" type="number" min="0" step="0.001" value={variant.quantity} onChange={(e) => updateVariant(index, "quantity", e.target.value)} />
        <input aria-label="Estoque mínimo" type="number" min="0" step="0.001" value={variant.minimumQuantity} onChange={(e) => updateVariant(index, "minimumQuantity", e.target.value)} />
        <input aria-label="Data do lembrete de reposição" type="date" value={variant.restockReminderOn} onChange={(e) => updateVariant(index, "restockReminderOn", e.target.value)} />
        <input aria-label="Custo" type="number" min="0" step="0.01" value={variant.unitCost} onChange={(e) => updateVariant(index, "unitCost", e.target.value)} />
        <input aria-label="Preço" type="number" min="0" step="0.01" value={variant.salePrice} onChange={(e) => updateVariant(index, "salePrice", e.target.value)} />
        <input aria-label="Localização" value={variant.location} onChange={(e) => updateVariant(index, "location", e.target.value)} />
        <button type="button" className="remove-row" aria-label="Remover variação" disabled={form.variants.length === 1} onClick={() => setForm({ ...form, variants: form.variants.filter((_, row) => row !== index) })}>×</button>
      </div>)}
    </div>
    <div className="module-actions"><button type="button" className="secondary-button" onClick={() => setForm({ ...form, variants: [...form.variants, emptyVariant()] })}>+ Variação</button><button className="primary-button" disabled={busy}>{busy ? "Salvando…" : "Cadastrar produto"}</button></div>
  </form>;
}

function EntryForm({ variants, suppliers, onSave, busy }) {
  const [header, setHeader] = useState({ supplier: "", supplierId: "", reference: "", note: "" });
  const [lines, setLines] = useState([emptyLine()]);
  function update(index, field, value) { setLines((current) => current.map((line, row) => row === index ? { ...line, [field]: value } : line)); }
  return <form className="inventory-form-stack" onSubmit={(event) => { event.preventDefault(); onSave({ ...header, lines }).then((ok) => { if (ok) { setHeader({ supplier: "", supplierId: "", reference: "", note: "" }); setLines([emptyLine()]); } }); }}>
    <div className="inventory-form-grid"><Label title="Fornecedor cadastrado"><select value={header.supplierId} onChange={(e) => { const selected = suppliers.find((item) => item.id === e.target.value); setHeader({ ...header, supplierId: e.target.value, supplier: selected?.name || "" }); }}><option value="">Sem fornecedor vinculado</option>{suppliers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Label><Label title="Nota ou referência"><input value={header.reference} onChange={(e) => setHeader({ ...header, reference: e.target.value })} /></Label><Label title="Observação"><input value={header.note} onChange={(e) => setHeader({ ...header, note: e.target.value })} /></Label></div>
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

function OrderForm({ variants, clients, suppliers, canDiscount, onSave, busy }) {
  const initial=()=>({ type:"sale",reference:"",partner:"",customerId:"",supplierId:"",paymentMethod:"pending",dueOn:"",discountAmount:"",lines:[emptyLine()] });
  const [form,setForm]=useState(initial),[scan,setScan]=useState("");
  const subtotal=form.lines.reduce((sum,line)=>sum+(Number(line.quantity)||0)*(Number(line.unitPrice)||0),0);
  const total=Math.max(0,subtotal-(Number(form.discountAmount)||0));
  function updateLine(index,field,value){setForm(current=>({...current,lines:current.lines.map((line,row)=>row===index?{...line,[field]:value}:line)}));}
  function addScanned(){const code=scan.trim().toLocaleLowerCase("pt-BR");if(!code)return;const item=variants.find(variant=>variant.sku.toLocaleLowerCase("pt-BR")===code);if(!item)return;setForm(current=>{const existing=current.lines.findIndex(line=>line.variantId===item.id);if(existing>=0)return{...current,lines:current.lines.map((line,index)=>index===existing?{...line,quantity:String((Number(line.quantity)||0)+1)}:line)};const next={...emptyLine(),variantId:item.id,quantity:"1",unitPrice:current.type==="sale"?item.salePrice:item.unitCost};const empty=current.lines.findIndex(line=>!line.variantId);return{...current,lines:empty>=0?current.lines.map((line,index)=>index===empty?next:line):[...current.lines,next]};});setScan("");}
  return <form className="inventory-form-stack" onSubmit={(event)=>{event.preventDefault();onSave({...form,subtotal,total}).then(ok=>{if(ok){setForm(initial());setScan("");}});}}>
    <div className="pos-scan"><Label title="Leitor SKU/EAN"><input value={scan} onChange={event=>setScan(event.target.value)} onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();addScanned();}}} placeholder="Leia ou digite o código e pressione Enter" /></Label><button type="button" className="secondary-button" onClick={addScanned}>Adicionar</button><small>O leitor funciona como teclado; para EAN, cadastre o número no campo SKU.</small></div>
    <div className="inventory-form-grid"><Label title="Operação"><select value={form.type} onChange={event=>setForm({...form,type:event.target.value,customerId:"",supplierId:"",partner:""})}><option value="sale">Venda</option><option value="purchase">Compra</option></select></Label><Label title="Pedido ou referência"><input value={form.reference} onChange={event=>setForm({...form,reference:event.target.value})} /></Label>{form.type==="sale"?<Label title="Cliente"><select value={form.customerId} onChange={event=>{const client=clients.find(item=>item.id===event.target.value);setForm({...form,customerId:event.target.value,partner:client?.name||form.partner});}}><option value="">Cliente avulso</option>{clients.map(client=><option key={client.id} value={client.id}>{client.name}</option>)}</select></Label>:<Label title="Fornecedor"><select value={form.supplierId} onChange={event=>{const supplier=suppliers.find(item=>item.id===event.target.value);setForm({...form,supplierId:event.target.value,partner:supplier?.name||""});}}><option value="">Sem fornecedor cadastrado</option>{suppliers.map(supplier=><option key={supplier.id} value={supplier.id}>{supplier.name}{supplier.leadTimeDays?` · ${supplier.leadTimeDays} dias`:""}</option>)}</select></Label>}{form.type==="sale"&&!form.customerId&&<Label title="Nome do cliente avulso"><input value={form.partner} onChange={event=>setForm({...form,partner:event.target.value})} /></Label>}{form.type==="purchase"&&!form.supplierId&&<Label title="Fornecedor avulso"><input value={form.partner} onChange={event=>setForm({...form,partner:event.target.value})} placeholder="Ou cadastre na aba Fornecedores" /></Label>}<Label title={form.type==="sale"?"Recebimento":"Pagamento"}><select value={form.paymentMethod} onChange={event=>setForm({...form,paymentMethod:event.target.value})}><option value="pending">A prazo / pendente</option><option value="cash">Dinheiro</option><option value="pix">Pix</option><option value="debit">Débito</option><option value="credit">Crédito</option><option value="transfer">Transferência</option><option value="other">Outro</option></select></Label>{form.paymentMethod==="pending"&&<Label title="Vencimento"><input required type="date" value={form.dueOn} onChange={event=>setForm({...form,dueOn:event.target.value})} /></Label>}{canDiscount&&<Label title="Desconto autorizado"><input type="number" min="0" max={subtotal} step="0.01" value={form.discountAmount} onChange={event=>setForm({...form,discountAmount:event.target.value})} /></Label>}</div>
    <div className="inventory-edit-table order-lines"><div className="inventory-table-head"><span>Produto</span><span>Saldo</span><span>Quantidade</span><span>Preço unitário</span><span>Total</span><span></span></div>{form.lines.map((line, index) => { const selected = variants.find((item) => item.id === line.variantId); return <div className="inventory-table-row" key={index}>
      <select required value={line.variantId} onChange={(e) => { const item = variants.find((variant) => variant.id === e.target.value); updateLine(index, "variantId", e.target.value); if (item) updateLine(index, "unitPrice", form.type === "sale" ? item.salePrice : item.unitCost); }}><option value="">Selecione</option>{variants.map((item) => <option key={item.id} value={item.id}>{item.product.name} · {item.name} · {item.sku}</option>)}</select>
      <span>{selected ? `${selected.quantity} ${selected.product.unit}` : "—"}</span>
      <input required type="number" min="0.001" step="0.001" value={line.quantity} onChange={(e) => updateLine(index, "quantity", e.target.value)} />
      <input required type="number" min="0" step="0.01" value={line.unitPrice} onChange={(e) => updateLine(index, "unitPrice", e.target.value)} />
      <strong>{money.format((Number(line.quantity) || 0) * (Number(line.unitPrice) || 0))}</strong>
      <button type="button" className="remove-row" disabled={form.lines.length === 1} onClick={() => setForm({ ...form, lines: form.lines.filter((_, row) => row !== index) })}>×</button>
    </div>; })}</div>
    <div className="order-total"><span>Subtotal {money.format(subtotal)}{Number(form.discountAmount)>0?` · desconto ${money.format(Number(form.discountAmount))}`:""}</span><strong>{money.format(total)}</strong><small>{form.paymentMethod==="pending"?"Gerará conta pendente":"Entrará no caixa agora"}</small></div><div className="module-actions"><button type="button" className="secondary-button" onClick={()=>setForm(current=>({...current,lines:[...current.lines,emptyLine()]}))}>+ Produto</button><button className="primary-button" disabled={busy||!variants.length||total<0}>{busy?"Concluindo…":`Concluir ${form.type==="sale"?"venda":"compra"}`}</button></div>
  </form>;
}

function AlertSettings({ variant, unit, busy, onSave }) {
  const [minimumQuantity, setMinimumQuantity] = useState(String(variant.minimumQuantity ?? 0));
  const [restockReminderOn, setRestockReminderOn] = useState(variant.restockReminderOn || "");
  useEffect(() => {
    setMinimumQuantity(String(variant.minimumQuantity ?? 0));
    setRestockReminderOn(variant.restockReminderOn || "");
  }, [variant.minimumQuantity, variant.restockReminderOn]);
  const low = Number(variant.quantity) <= Number(variant.minimumQuantity);
  const dateDue = Boolean(variant.restockReminderOn && variant.restockReminderOn <= localDateText());
  return <form className={`stock-alert-settings${low || dateDue ? " due" : ""}`} onSubmit={(event) => { event.preventDefault(); onSave({ variantId: variant.id, minimumQuantity, restockReminderOn }); }}>
    <div><strong>{low || dateDue ? "Alerta ativo" : "Aviso de reposição"}</strong><small>{low ? `Saldo chegou ao limite de ${variant.minimumQuantity} ${unit}.` : dateDue ? `Data de revisão alcançada em ${new Date(`${variant.restockReminderOn}T12:00:00`).toLocaleDateString("pt-BR")}.` : "A luz vermelha aparecerá quando o limite ou a data forem alcançados."}</small></div>
    <Label title={`Avisar quando restarem (${unit})`}><input required type="number" min="0" step="0.001" value={minimumQuantity} onChange={(event) => setMinimumQuantity(event.target.value)} /></Label>
    <Label title="Lembrar a partir de"><input type="date" value={restockReminderOn} onChange={(event) => setRestockReminderOn(event.target.value)} /></Label>
    <button className="secondary-button compact" disabled={busy}>{busy ? "Salvando…" : "Salvar aviso"}</button>
  </form>;
}

function SupplierForm({ onSave, busy }) {
  const empty = () => ({ name: "", document: "", contactName: "", email: "", phone: "", leadTimeDays: "" });
  const [form, setForm] = useState(empty);
  return <form className="inventory-form-stack" onSubmit={(event) => { event.preventDefault(); onSave(form).then((ok) => { if (ok) setForm(empty()); }); }}>
    <div className="inventory-form-grid">
      <Label title="Fornecedor"><input required maxLength="160" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Razão social ou nome" /></Label>
      <Label title="CPF / CNPJ"><input maxLength="24" value={form.document} onChange={(event) => setForm({ ...form, document: event.target.value })} /></Label>
      <Label title="Pessoa de contato"><input maxLength="120" value={form.contactName} onChange={(event) => setForm({ ...form, contactName: event.target.value })} /></Label>
      <Label title="E-mail"><input type="email" maxLength="254" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Label>
      <Label title="Telefone"><input maxLength="32" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></Label>
      <Label title="Prazo médio de entrega" hint="Em dias"><input type="number" min="0" max="365" value={form.leadTimeDays} onChange={(event) => setForm({ ...form, leadTimeDays: event.target.value })} /></Label>
    </div>
    <div className="module-actions"><button className="primary-button" disabled={busy}>{busy ? "Salvando…" : "Cadastrar fornecedor"}</button></div>
  </form>;
}

function ImportPanel({ onImport, onEntryImport, variants, busy, requestFileName }) {
  const [mode, setMode] = useState("products");
  const [pasted, setPasted] = useState(""); const [preview, setPreview] = useState(null); const [error, setError] = useState("");
  const [entryHeader, setEntryHeader] = useState({ supplier: "", reference: "" });
  const matchedEntry = useMemo(() => preview && mode === "entry" ? matchInventoryEntry(preview, variants) : null, [preview, variants, mode]);
  const previewRows = useMemo(() => (preview?.products || []).flatMap((product) => product.variants.map((variant) => ({
    product: product.name, unit: product.unit, ...variant,
  }))), [preview]);
  function show(result) { setPreview(result); setError(result.errors?.length ? result.errors.slice(0, 8).join(" ") : ""); }
  async function fileChanged(file) { if (!file) return; try { show(await parseInventoryFile(file)); } catch (cause) { setPreview(null); setError(cause.message); } }
  function parsePaste() { try { show(parseInventoryText(pasted)); } catch (cause) { setPreview(null); setError(cause.message); } }
  async function template() {
    const filename = await requestFileName({ suggestedName: "modelo-estoque-candtech", extension: "csv", description: "Escolha o nome do modelo de planilha." });
    if (!filename) return;
    const blob = new Blob(["\uFEFF", INVENTORY_TEMPLATE], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = filename; link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 30_000);
  }
  const validationErrors = mode === "entry" ? matchedEntry?.errors || [] : preview?.errors || [];
  return <div className="inventory-form-stack"><div className="import-mode" role="group" aria-label="Objetivo da planilha"><button type="button" className={mode === "products" ? "active" : ""} onClick={() => { setMode("products"); setPreview(null); setError(""); }}><strong>Cadastrar produtos novos</strong><span>Cria os SKUs e registra o saldo inicial</span></button><button type="button" className={mode === "entry" ? "active" : ""} onClick={() => { setMode("entry"); setPreview(null); setError(""); }}><strong>Dar entrada em SKUs existentes</strong><span>Soma somente a quantidade recebida</span></button></div>
    {mode === "entry" && <div className="inventory-message import-warning"><strong>Atenção:</strong> na coluna Quantidade, informe apenas o que chegou agora. O sistema somará ao saldo atual; não cole o saldo total.</div>}
    {mode === "entry" && <div className="inventory-form-grid"><Label title="Fornecedor"><input value={entryHeader.supplier} onChange={(event) => setEntryHeader({ ...entryHeader, supplier: event.target.value })} /></Label><Label title="Nota ou referência"><input value={entryHeader.reference} onChange={(event) => setEntryHeader({ ...entryHeader, reference: event.target.value })} /></Label></div>}
    <div className="import-options"><label className="file-drop"><strong>Selecionar planilha</strong><span>CSV, TSV, TXT ou XLSX</span><input type="file" accept=".csv,.tsv,.txt,.xlsx" onChange={(e) => fileChanged(e.target.files?.[0])} /></label><div><strong>Ou cole linhas do Excel</strong><textarea rows="7" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={INVENTORY_TEMPLATE} /><button type="button" className="secondary-button" onClick={parsePaste}>Preparar prévia</button></div></div>
    <button type="button" className="text-button" onClick={template}>Baixar modelo preenchido</button>
    {error && <div className="inventory-message error">{error}</div>}
    {preview?.warnings?.length > 0 && <div className="inventory-message import-warning"><strong>Ajustes automáticos:</strong> {preview.warnings.join(" ")}</div>}
    {matchedEntry?.errors.length > 0 && <div className="inventory-message error">{matchedEntry.errors.slice(0, 8).join(" ")}</div>}
    {preview && <div className="import-values-preview"><div className="import-values-head"><span>Produto</span><span>SKU</span><span>Quantidade</span><span>Custo</span><span>Preço de venda</span></div>{previewRows.slice(0, 50).map((row) => <div className="import-values-row" key={row.sku}><span>{row.product}<small>{row.name !== "Padrão" ? row.name : ""}</small></span><strong>{row.sku}</strong><span>{preview.hasQuantityColumn ? `${row.quantity} ${row.unit}` : "Não informada"}</span><span>{money.format(row.unitCost)}</span><span>{money.format(row.salePrice)}</span></div>)}{previewRows.length > 50 && <small className="import-values-more">Mostrando 50 de {previewRows.length} linhas. Todas serão validadas antes da gravação.</small>}</div>}
    {preview && <div className="import-preview"><strong>Prévia antes de gravar</strong><span>{mode === "entry" ? `${matchedEntry?.lines.length || 0} SKUs encontrados no cadastro` : `${preview.variantCount} SKUs em ${preview.products.length} produtos`}</span><small>Nenhuma linha será gravada até sua confirmação.</small><button className="primary-button" disabled={busy || validationErrors.length > 0 || (mode === "entry" && !matchedEntry?.lines.length)} onClick={() => mode === "entry" ? onEntryImport(matchedEntry.lines, entryHeader) : onImport(preview.products)}>{busy ? "Importando…" : mode === "entry" ? "Confirmar entrada" : "Confirmar cadastro"}</button></div>}
  </div>;
}

export default function InventoryOperations({ initialSection = "overview", onSnapshot, onDeliveriesChange, clients = [], canExport = false, canUseDrive = false, canDiscount = false, driveStatus }) {
  const { requestFileName, fileNameDialogProps } = useFileNameDialog();
  const [inventory, setInventory] = useState({ products: [], suppliers: [], batches: [], orders: [], lots: [], deliveries: [], insights: { items: [], summary: {} } });
  const [section, setSection] = useState(initialSection); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(""); const [error, setError] = useState(false); const [duplicate, setDuplicate] = useState(null);
  const pendingIdempotency = useRef(new Map());
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
  const insightItems = inventory.insights?.items || [];
  const insightSummary = inventory.insights?.summary || {};
  const totalValue = Number(insightSummary.averageCostStockValue ?? variants.reduce((sum, item) => sum + item.quantity * item.unitCost, 0));
  const reorderItems = insightItems.filter((item) => item.reorderQuantity > 0);
  const idleItems = insightItems.filter((item) => item.idle);
  const todayText = localDateText();
  const low = variants.filter((item) => item.quantity <= item.minimumQuantity || (item.restockReminderOn && item.restockReminderOn <= todayText));
  const categoryValues = useMemo(() => {
    const totals = new Map();
    const averageCostByVariant = new Map(insightItems.map((item) => [item.variantId, item.averageUnitCost]));
    variants.forEach((item) => {
      const category = item.product.category || "Sem categoria";
      totals.set(category, (totals.get(category) || 0) + item.quantity * (averageCostByVariant.get(item.id) ?? item.unitCost));
    });
    return [...totals.entries()].map(([category, value]) => ({ category, value })).sort((a, b) => b.value - a.value).slice(0, 6);
  }, [variants, insightItems]);
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
  useEffect(() => {
    if (!onSnapshot || loading) return;
    // O resumo fica no workspace para a Visão geral abrir imediatamente; o
    // cadastro oficial e as movimentações continuam protegidos pela API.
    onSnapshot({
      products: variants.map((item) => ({ id: item.id, name: `${item.product.name}${item.name === "Padrão" ? "" : ` · ${item.name}`}`, sku: item.sku, quantity: item.quantity, minimum: item.minimumQuantity, restockReminderOn: item.restockReminderOn || "", unitCost: item.unitCost, location: item.location, lockedAt: "relational" })),
      orders: (inventory.orders || []).map((order) => ({
        id: order.id,
        type: order.type === "sale" ? "venda" : "compra",
        amount: Number(order.total) || 0,
        partner: order.partner || "",
        date: String(order.created_at || "").slice(0, 10),
        status: "concluido",
      })),
      deliveries: inventory.deliveries || [],
    });
  }, [inventory, loading]);
  useEffect(() => {
    const pendingFilename = sessionStorage.getItem("candtech_pending_inventory_drive");
    if (loading || !canUseDrive || !pendingFilename) return;
    sessionStorage.removeItem("candtech_pending_inventory_drive");
    sendInventoryToDrive(pendingFilename);
  }, [loading, canUseDrive]);
  async function post(payload, success) { setBusy(true); setMessage(""); const serialized = JSON.stringify(payload); const idempotencyKey = pendingIdempotency.current.get(serialized) || globalThis.crypto?.randomUUID?.() || `inventory-${Date.now()}-${Math.random().toString(36).slice(2)}`; pendingIdempotency.current.set(serialized, idempotencyKey); try { const response = await fetch("/api/inventory", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey }, body: serialized }); const body = await response.json(); if (!response.ok) throw new Error(body.error); pendingIdempotency.current.delete(serialized); setInventory(body.inventory); setError(false); setMessage(success); return true; } catch (cause) { setError(true); setMessage(cause.message || "Não foi possível concluir."); return false; } finally { setBusy(false); } }
  function changeDeliveries(next) {
    setInventory((current) => ({ ...current, deliveries: next }));
    onDeliveriesChange?.(next);
  }
  function addDelivery() {
    changeDeliveries([...(inventory.deliveries || []), { id: globalThis.crypto?.randomUUID?.() || `delivery-${Date.now()}`,
      clientId: "", orderId: "", description: "", partner: "", direction: "saida", date: "", status: "preparando", tracking: "", hasProof: false }]);
  }
  function updateDelivery(index, patch) {
    changeDeliveries((inventory.deliveries || []).map((delivery, rowIndex) => rowIndex === index ? { ...delivery, ...patch } : delivery));
  }
  async function uploadDeliveryProof(index, file) {
    if (!file) return;
    setBusy(true); setMessage("");
    try {
      const delivery = inventory.deliveries[index];
      const response = await fetch(`/api/inventory/deliveries/${delivery.id}/proof`, { method: "PUT",
        headers: { "Content-Type": file.type, "X-File-Name": encodeURIComponent(file.name) }, body: file });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      updateDelivery(index, { hasProof: true });
      setError(false); setMessage("Comprovante privado anexado à entrega.");
    } catch (cause) { setError(true); setMessage(cause.message || "Não foi possível anexar o comprovante."); }
    finally { setBusy(false); }
  }
  async function downloadInventory(format) {
    const filename = await requestFileName({ suggestedName: `estoque-candtech-${new Date().toISOString().slice(0, 10)}`, extension: format, description: "Escolha o nome do relatório de estoque." });
    if (!filename) return;
    const link = document.createElement("a");
    link.href = `/api/inventory/export?format=${format}&filename=${encodeURIComponent(filename)}`;
    link.download = filename;
    document.body.appendChild(link); link.click(); link.remove();
  }
  async function sendInventoryToDrive(providedFilename = "") {
    const filename = providedFilename || await requestFileName({ suggestedName: `estoque-candtech-${new Date().toISOString().slice(0, 10)}`, extension: "xlsx", description: "Este será o nome exibido no seu Google Drive." });
    if (!filename) return;
    setBusy(true); setMessage("Enviando relatório do estoque ao Google Drive…"); setError(false); setDriveFile(null);
    try {
      const response = await fetch("/api/inventory/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename }) });
      const body = await response.json();
      if (body.needsConnection) { window.location.assign(`/api/google-drive/connect?returnTo=inventory&filename=${encodeURIComponent(filename)}`); return; }
      if (!response.ok) throw new Error(body.error);
      setDriveFile(body.file); setMessage(`Arquivo ${body.file.name} enviado ao Google Drive.`);
    } catch (cause) { setError(true); setMessage(cause.message || "Não foi possível enviar ao Google Drive."); }
    finally { setBusy(false); }
  }
  const sections = [["overview", "Visão geral"], ["entry", "Entrada rápida"], ["products", "Produtos e variações"], ["suppliers", "Fornecedores"], ["import", "Importar planilha"], ["orders", "Pedidos"], ["deliveries", "Entregas"], ["lots", "Lotes e validades"], ["history", "Movimentações"], ["guide", "Como operar"]];
  if (loading) return <section className="panel"><p>Carregando estoque organizado…</p></section>;
  return <div className="business-stack relational-inventory">
    <section className="panel inventory-command-bar"><div><span className="eyebrow">ESTOQUE RELACIONAL</span><h2>Operação guiada</h2><p>Cadastre uma vez e movimente por entradas, compras e vendas. Cada alteração fica registrada.</p></div><nav aria-label="Áreas do estoque">{sections.map(([id, label]) => <button key={id} className={section === id ? "active" : ""} onClick={() => setSection(id)}>{label}</button>)}</nav></section>
    {message && <div className={error ? "inventory-message error" : "inventory-message"}>{message}</div>}
    {section === "overview" && <>
      <div className="summary-grid"><article><span>Produtos</span><strong>{inventory.products.length}</strong><small>{variants.length} SKUs</small></article><article><span>Fornecedores</span><strong>{inventory.suppliers?.length || 0}</strong><small>Ligados às compras</small></article><article><span>Unidades em estoque</span><strong>{totalUnits}</strong><small>Somadas em todas as variações</small></article><article><span>Valor pelo custo médio</span><strong>{money.format(totalValue)}</strong><small>Histórico ponderado de entradas</small></article><article><span>Alertas</span><strong>{reorderItems.length + datedLots.length + idleItems.length}</strong><small>Reposição, validade ou item parado</small></article></div>
      <section className="panel"><div className="panel-heading"><div><span className="eyebrow">PRÓXIMA AÇÃO</span><h2>Atalhos para o funcionário</h2></div></div><div className="inventory-shortcuts"><button onClick={() => setSection("entry")}><strong>Mercadoria chegou</strong><span>Registrar entrada de vários itens</span></button><button onClick={() => setSection("orders")}><strong>Venda ou compra</strong><span>Montar pedido com vários produtos</span></button><button onClick={() => setSection("import")}><strong>Usar planilha</strong><span>Cadastrar produtos ou dar entrada por SKU</span></button></div></section>
      <div className="inventory-insights-grid">
        <section className="panel"><div className="panel-heading"><div><span className="eyebrow">VALOR PARADO</span><h2>Estoque por categoria</h2><p>Mostra onde está concentrado o dinheiro investido em mercadorias.</p></div></div>{categoryValues.length ? <div className="inventory-value-chart">{categoryValues.map((item) => <div key={item.category}><span><strong>{item.category}</strong><small>{money.format(item.value)}</small></span><i><b style={{ width: `${Math.max(3, item.value / largestCategoryValue * 100)}%` }} /></i></div>)}</div> : <p className="empty-state">Cadastre produtos com custo para visualizar o gráfico.</p>}</section>
        {canExport && <section className="panel inventory-report-panel"><div className="panel-heading"><div><span className="eyebrow">RELATÓRIO</span><h2>Levar ou compartilhar os dados</h2><p>O CSV serve para conferência e reimportação; o Excel já sai organizado para apresentação.</p></div></div><div className="module-actions"><button className="secondary-button" onClick={() => downloadInventory("csv")}>Baixar CSV</button><button className="secondary-button" onClick={() => downloadInventory("xlsx")}>Baixar Excel</button>{canUseDrive && driveStatus?.configured && <button className="primary-button" disabled={busy} onClick={() => sendInventoryToDrive()}>{busy ? "Enviando…" : "Enviar ao Google Drive"}</button>}</div>{canUseDrive && driveStatus && !driveStatus.loading && !driveStatus.configured && <small>O administrador ainda precisa configurar as credenciais do Google Drive no servidor.</small>}{driveFile?.webViewLink && <a className="drive-file-link" href={driveFile.webViewLink} target="_blank" rel="noreferrer">Abrir {driveFile.name} no Google Drive</a>}</section>}
      </div>
      {insightItems.length > 0 && <section className="panel"><div className="panel-heading"><div><span className="eyebrow">DECISÃO DE COMPRA E VENDA</span><h2>Curva ABC, custo médio e reposição</h2><p>A prioriza os itens que mais faturam. A sugestão compra somente a diferença até o estoque mínimo cadastrado.</p></div></div><div className="inventory-performance-table"><div className="inventory-performance-head"><span>Item</span><span>ABC</span><span>Custo médio</span><span>Faturamento</span><span>Ação</span></div>{insightItems.map((item) => <div className="inventory-performance-row" key={item.variantId}><span><strong>{item.productName} · {item.variantName}</strong><small>{item.sku} · saldo {item.quantity} {item.unit}</small></span><span><b className={`abc-badge abc-${item.abcClass.toLowerCase()}`}>{item.abcClass}</b></span><span>{money.format(item.averageUnitCost)}</span><span>{money.format(item.saleRevenue)}</span><span>{item.reorderQuantity > 0 ? `Comprar ${item.reorderQuantity} ${item.unit}` : item.idle ? `${item.daysWithoutSale} dias sem venda` : "Estoque adequado"}</span></div>)}</div></section>}
      {idleItems.length > 0 && <section className="panel"><div className="panel-heading"><div><span className="eyebrow">CAPITAL PARADO</span><h2>Itens há 90 dias sem venda</h2><p>{money.format(insightSummary.idleStockValue || 0)} em estoque pelo custo médio histórico.</p></div></div><div className="stock-alert-list">{idleItems.map((item) => <div key={item.variantId}><strong>{item.productName} · {item.variantName}</strong><span>{item.daysWithoutSale} dias · {item.quantity} {item.unit}</span></div>)}</div></section>}
      {datedLots.length > 0 && <section className="panel expiry-alert-panel"><div className="panel-heading"><div><span className="eyebrow">VALIDADE</span><h2>Lotes vencidos ou próximos de vencer</h2><p>O saldo é atualizado a cada venda, usando primeiro o lote que vence antes (FEFO).</p></div><button className="secondary-button compact" onClick={() => setSection("lots")}>Ver todos os lotes</button></div><div className="stock-alert-list">{datedLots.map((lot) => <div key={`${lot.variant_id}-${lot.lot_code}-${lot.expires_on}`}><strong>{lot.product_name} · {lot.variant_name}</strong><span className={lot.days < 0 ? "expiry-overdue" : ""}>{lot.days < 0 ? `Venceu há ${Math.abs(lot.days)} dia(s)` : lot.days === 0 ? "Vence hoje" : `Vence em ${lot.days} dia(s)`}</span></div>)}</div></section>}
      {low.length > 0 && <section className="panel stock-warning-panel"><div className="panel-heading"><div><span className="eyebrow">ATENÇÃO</span><h2>Avisos de reposição</h2></div></div><div className="stock-alert-list">{low.map((item) => { const quantityLow = item.quantity <= item.minimumQuantity; const dateDue = item.restockReminderOn && item.restockReminderOn <= todayText; return <div key={item.id}><strong>{item.product.name} · {item.name}</strong><span>{quantityLow ? `${item.quantity} ${item.product.unit} disponíveis · avisar em ${item.minimumQuantity}` : "Quantidade acima do limite"}{dateDue ? ` · lembrete desde ${new Date(`${item.restockReminderOn}T12:00:00`).toLocaleDateString("pt-BR")}` : ""}</span></div>; })}</div></section>}
    </>}
    {section === "products" && <><section className="panel"><div className="panel-heading"><div><span className="eyebrow">CADASTRO</span><h2>Novo produto e variações</h2><p>Uma cor, tamanho, sabor ou modelo deve possuir SKU próprio. Informe também a quantidade e a data em que deseja receber o aviso.</p></div></div><ProductForm initial={duplicate} busy={busy} onSave={async (product) => { const ok = await post({ action: "create-products", products: [product] }, "Produto cadastrado com saldo inicial e aviso de reposição."); if (ok) setDuplicate(null); return ok; }} /></section><section className="panel"><div className="panel-heading"><div><span className="eyebrow">CATÁLOGO</span><h2>{inventory.products.length} produtos cadastrados</h2><p>Ajuste o limite e a data de cada SKU quando precisar.</p></div></div><div className="inventory-catalog-search"><Label title="Buscar no catálogo"><input value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="Produto, categoria, variação ou SKU" /></Label></div><div className="product-catalog">{filteredProducts.map((product) => <article key={product.id}><header><div><strong>{product.name}</strong><small>{product.category || "Sem categoria"} · {product.unit}</small></div><button className="text-button" onClick={() => { setDuplicate({ name: `${product.name} cópia`, category: product.category, unit: product.unit, variants: product.variants.map((variant) => ({ ...emptyVariant(), ...variant, quantity: 0, sku: `${variant.sku}-COPIA` })) }); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Duplicar</button></header>{product.variants.map((variant) => <div className="catalog-variant-block" key={variant.id}><div className="catalog-variant"><span><strong>{variant.name}</strong><small>{variant.sku}</small></span><span>{variant.quantity} {product.unit}</span><span>{money.format(variant.salePrice)}</span></div><AlertSettings variant={variant} unit={product.unit} busy={busy} onSave={(alert) => post({ action: "update-alert", ...alert }, "Aviso de reposição atualizado.")} /></div>)}</article>)}</div>{!filteredProducts.length && <p className="empty-state">Nenhum produto corresponde à busca.</p>}</section></>}
    {section === "entry" && <section className="panel"><div className="panel-heading"><div><span className="eyebrow">RECEBIMENTO</span><h2>Entrada rápida de mercadorias</h2><p>Informe vários produtos e confirme uma única vez. Lote e validade são opcionais para varejo e recomendados para alimentos.</p></div></div><EntryForm variants={variants} suppliers={inventory.suppliers || []} busy={busy} onSave={(data) => post({ action: "entry", ...data }, "Entrada registrada. Os saldos e custos foram atualizados.")} /></section>}
    {section === "suppliers" && <><section className="panel"><div className="panel-heading"><div><span className="eyebrow">COMPRAS ORGANIZADAS</span><h2>Novo fornecedor</h2><p>Cadastre uma vez para selecionar nas compras e acompanhar prazo, volume e contato.</p></div></div><SupplierForm busy={busy} onSave={(supplier) => post({ action: "create-supplier", supplier }, "Fornecedor cadastrado e disponível nas compras.")} /></section><section className="panel"><div className="panel-heading"><div><span className="eyebrow">BASE DE FORNECEDORES</span><h2>{inventory.suppliers?.length || 0} fornecedor(es)</h2><p>Os totais consideram somente compras concluídas e não canceladas.</p></div></div><div className="batch-list">{(inventory.suppliers || []).map((supplier) => <div key={supplier.id}><span><strong>{supplier.name}</strong><small>{[supplier.contactName, supplier.email, supplier.phone].filter(Boolean).join(" · ") || "Sem contato informado"}{supplier.leadTimeDays ? ` · entrega média em ${supplier.leadTimeDays} dia(s)` : ""}</small></span><span><strong>{money.format(supplier.totalPurchased)}</strong><small>{supplier.purchaseCount} compra(s){supplier.lastPurchaseAt ? ` · última em ${new Date(supplier.lastPurchaseAt).toLocaleDateString("pt-BR")}` : ""}</small></span></div>)}</div>{!(inventory.suppliers || []).length && <p className="empty-state">Cadastre o primeiro fornecedor para vinculá-lo às entradas e compras.</p>}</section></>}
    {section === "import" && <section className="panel"><div className="panel-heading"><div><span className="eyebrow">PLANILHA ASSISTIDA</span><h2>Cadastro ou entrada em lote</h2><p>Escolha primeiro o objetivo e revise a prévia. O sistema confere SKUs antes de alterar qualquer saldo.</p></div></div><ImportPanel variants={variants} busy={busy} requestFileName={requestFileName} onImport={(products) => post({ action: "import-products", products, reference: "Importação por planilha" }, "Produtos importados e saldo inicial registrado.")} onEntryImport={(lines, header) => post({ action: "entry", lines, ...header, note: "Entrada conferida por planilha" }, "Entrada por planilha registrada nos SKUs existentes.")} /></section>}
    {section === "orders" && <><section className="panel"><div className="panel-heading"><div><span className="eyebrow">PDV E PEDIDOS</span><h2>Venda rápida ou compra</h2><p>Leia o SKU/EAN, selecione cliente ou fornecedor e confirme uma vez. Estoque e financeiro são registrados juntos.</p></div></div><OrderForm variants={variants} clients={clients} suppliers={inventory.suppliers || []} canDiscount={canDiscount} busy={busy} onSave={(data) => post({ action: "order", ...data }, `${data.type === "sale" ? "Venda" : "Compra"} concluída com estoque e financeiro atualizados.`)} /></section>{inventory.orders.length > 0 && <section className="panel"><div className="panel-heading"><div><span className="eyebrow">RECENTES</span><h2>Últimos pedidos</h2></div></div><div className="batch-list">{inventory.orders.map((order) => <div key={order.id}><span><strong>{order.type === "sale" ? "Venda" : "Compra"} · {order.reference || "Sem referência"}</strong><small>{order.partner || "Sem cliente/fornecedor"} · {new Date(order.created_at).toLocaleString("pt-BR")} · {order.payment_status === "paid" ? "recebido" : order.payment_status === "refunded" ? "estornado" : order.payment_status === "cancelled" ? "cancelado" : `vence ${order.due_on ? new Date(`${String(order.due_on).slice(0,10)}T12:00:00`).toLocaleDateString("pt-BR") : "hoje"}`}</small></span><span><strong>{money.format(order.total)}</strong>{Number(order.discount_amount)>0&&<small>Desconto {money.format(Number(order.discount_amount))}</small>}{order.status === "cancelled" && <small>Cancelado</small>}</span></div>)}</div></section>}</>}
    {section === "deliveries" && <section className="panel"><div className="panel-heading"><div><span className="eyebrow">LOGÍSTICA CONECTADA</span><h2>Entregas ligadas ao pedido e ao cliente</h2><p>Cada nova venda já cria uma entrega em preparação. Complete a previsão e o rastreio; o workspace salva automaticamente.</p></div><button className="primary-button compact" onClick={addDelivery}>+ Entrega avulsa</button></div><div className="delivery-operations">{(inventory.deliveries || []).map((delivery, index) => <article className="delivery-operation-card" key={delivery.id}><header><div><strong>{delivery.description || "Nova entrega"}</strong><small>{delivery.orderId ? "Vinculada a pedido" : "Entrega avulsa"}{delivery.hasProof ? " · comprovante privado anexado" : ""}</small></div><span className={`batch-status ${delivery.status === "entregue" ? "active" : delivery.status === "cancelada" ? "reversed" : ""}`}>{({ preparando: "Preparando", "em-transito": "Em trânsito", entregue: "Entregue", cancelada: "Cancelada" })[delivery.status]}</span></header><div className="delivery-operation-fields"><Label title="Pedido"><select value={delivery.orderId || ""} onChange={(event) => { const order = inventory.orders.find((item) => item.id === event.target.value); updateDelivery(index, { orderId: event.target.value, ...(order ? { partner: order.partner || delivery.partner, description: `Entrega ${order.reference || order.id.slice(0, 8)}` } : {}) }); }}><option value="">Sem pedido</option>{inventory.orders.filter((order) => order.type === "sale" && order.status !== "cancelled").map((order) => <option key={order.id} value={order.id}>{order.reference || order.id.slice(0, 8)} · {order.partner || "Cliente"}</option>)}</select></Label><Label title="Cliente"><select value={delivery.clientId || ""} onChange={(event) => { const client = clients.find((item) => item.id === event.target.value); updateDelivery(index, { clientId: event.target.value, ...(client ? { partner: client.name } : {}) }); }}><option value="">Sem cliente cadastrado</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></Label><Label title="Descrição"><input value={delivery.description} maxLength="160" onChange={(event) => updateDelivery(index, { description: event.target.value })} /></Label><Label title="Previsão"><input type="date" value={delivery.date || ""} onChange={(event) => updateDelivery(index, { date: event.target.value })} /></Label><Label title="Status"><select value={delivery.status} onChange={(event) => updateDelivery(index, { status: event.target.value })}><option value="preparando">Preparando</option><option value="em-transito">Em trânsito</option><option value="entregue">Entregue</option><option value="cancelada">Cancelada</option></select></Label><Label title="Rastreio"><input value={delivery.tracking || ""} maxLength="120" onChange={(event) => updateDelivery(index, { tracking: event.target.value })} placeholder="Código ou responsável" /></Label></div><div className="delivery-proof-actions"><label className="secondary-button compact file-button">{delivery.hasProof ? "Substituir comprovante" : "Anexar comprovante"}<input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => uploadDeliveryProof(index, event.target.files?.[0])} /></label>{delivery.hasProof && <a className="text-button" href={`/api/inventory/deliveries/${delivery.id}/proof`}>Baixar comprovante</a>}{!delivery.orderId && <button className="text-button danger-button" onClick={() => confirm("Excluir esta entrega avulsa?") && changeDeliveries(inventory.deliveries.filter((_, rowIndex) => rowIndex !== index))}>Excluir entrega avulsa</button>}</div></article>)}</div>{!(inventory.deliveries || []).length && <p className="empty-state">Nenhuma entrega. Concluir uma venda cria a primeira automaticamente.</p>}</section>}
    {section === "lots" && <section className="panel"><div className="panel-heading"><div><span className="eyebrow">RASTREABILIDADE FEFO</span><h2>Saldo atual por lote e validade</h2><p>As vendas consomem automaticamente primeiro o lote que vence antes. Lotes sem validade ficam por último.</p></div></div><div className="batch-list">{(inventory.lots || []).map((lot) => <div key={`${lot.variant_id}-${lot.lot_code}-${lot.expires_on || "sem-data"}`}><span><strong>{lot.product_name} · {lot.variant_name}</strong><small>{lot.sku} · lote {lot.lot_code || "não informado"}</small></span><span><strong>{lot.available_quantity} disponíveis</strong><small>{lot.expires_on ? `Validade ${new Date(`${String(lot.expires_on).slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR")}` : "Sem validade informada"}</small></span></div>)}</div>{!(inventory.lots || []).length && <p className="empty-state">Nenhum lote com saldo disponível.</p>}</section>}
    {section === "history" && <section className="panel"><div className="panel-heading"><div><span className="eyebrow">AUDITORIA</span><h2>Movimentações recentes</h2><p>Desfazer cria uma movimentação inversa; o registro original permanece para conferência.</p></div></div><div className="batch-list">{inventory.batches.map((batch) => <div key={batch.id}><span><strong>{({ entry: "Entrada", import: "Importação", sale: "Venda", purchase: "Compra", reversal: "Desfazimento", adjustment: "Ajuste" })[batch.kind] || batch.kind} · {batch.reference || "Sem referência"}</strong><small>{batch.item_count} itens · {batch.total_units} unidades · {new Date(batch.created_at).toLocaleString("pt-BR")}</small></span><span className={`batch-status ${batch.status}`}>{batch.status === "reversed" ? "Desfeita" : "Ativa"}</span>{batch.status === "active" && batch.kind !== "reversal" && <button className="secondary-button danger-button compact" disabled={busy} onClick={() => confirm("Desfazer toda esta operação? O histórico será preservado.") && post({ action: "undo-batch", batchId: batch.id }, "Operação desfeita com registro de auditoria.")}>Desfazer</button>}</div>)}</div>{!inventory.batches.length && <p className="empty-state">Nenhuma movimentação registrada.</p>}</section>}
    {section === "guide" && <section className="panel employee-guide"><div className="panel-heading"><div><span className="eyebrow">CAPACITAÇÃO</span><h2>Rotina simples para o funcionário</h2><p>Use esta sequência no treinamento. O funcionário não precisa conhecer banco de dados nem cálculos.</p></div></div><ol><li><strong>Produto novo:</strong> abra “Produtos e variações”, cadastre o nome e crie um SKU para cada modelo, cor, sabor ou tamanho.</li><li><strong>Mercadoria recebida:</strong> abra “Entrada rápida”, escolha os itens, informe quantidade e custo e confirme uma vez.</li><li><strong>Muitas mercadorias:</strong> em “Importar planilha”, escolha “Dar entrada em SKUs existentes” e informe somente a quantidade que chegou.</li><li><strong>Venda ou compra:</strong> abra “Pedidos”, adicione todos os produtos e confira o total antes de concluir.</li><li><strong>Estoque inicial grande:</strong> na planilha, escolha “Cadastrar produtos novos”, preencha o modelo e confira a prévia.</li><li><strong>Erro operacional:</strong> não altere o saldo manualmente; abra “Movimentações” e use “Desfazer”.</li><li><strong>Alimentos:</strong> sempre informe lote e validade na entrada para permitir rastreamento.</li><li><strong>Relatório:</strong> na “Visão geral”, baixe Excel/CSV ou envie ao Drive conforme sua permissão.</li></ol><div className="training-rule"><strong>Regra principal</strong><span>SKU identifica o item. Quantidade muda por entrada, compra, venda ou desfazimento — nunca por edição escondida.</span></div></section>}
    {fileNameDialogProps && <FileNameDialog {...fileNameDialogProps} />}
  </div>;
}
