import test from "node:test";
import assert from "node:assert/strict";
import { strToU8, zipSync } from "fflate";
import {
  markFinancialDuplicates,
  parseFinancialFile,
  parseFinancialOfx,
  parseFinancialText,
} from "../lib/financial-import.js";

test("prévia CSV normaliza datas, sinais e impressão digital estável", async () => {
  const csv = [
    "Data;Descrição;Valor;Identificador",
    "31/08/2026;Venda balcão;1.234,56;TX-1",
    "30/08/2026;Tarifa bancária;-12,90;TX-2",
  ].join("\n");
  const first = await parseFinancialText(csv);
  const second = await parseFinancialText(csv);
  assert.equal(first.rows.length, 2);
  assert.deepEqual(first.rows.map((row) => [row.date, row.type, row.amount]), [
    ["2026-08-31", "entrada", 1234.56],
    ["2026-08-30", "saida", 12.9],
  ]);
  assert.match(first.rows[0].fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(first.rows[0].fingerprint, second.rows[0].fingerprint);
});

test("OFX usa FITID, aceita SGML e detecta reimportação", async () => {
  const ofx = `<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
    <STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260831120000[-3:BRT]<TRNAMT>180.00<FITID>PIX-180<NAME>PIX RECEBIDO<MEMO>Cliente A
    <STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260830120000[-3:BRT]<TRNAMT>-60.00<FITID>MENSAL-60<NAME>MENSALIDADE
    </BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  const preview = await parseFinancialOfx(ofx);
  assert.equal(preview.rows.length, 2);
  assert.equal(preview.rows[0].description, "PIX RECEBIDO — Cliente A");
  const marked = markFinancialDuplicates(preview.rows, [{ fingerprint: preview.rows[0].fingerprint }]);
  assert.equal(marked.duplicateCount, 1);
  assert.deepEqual(marked.accepted.map((row) => row.amount), [60]);
});

test("XLSX é lido localmente e convertido na mesma prévia", async () => {
  const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>Data</t></is></c><c r="B1" t="inlineStr"><is><t>Descrição</t></is></c><c r="C1" t="inlineStr"><is><t>Crédito</t></is></c><c r="D1" t="inlineStr"><is><t>Débito</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>31/08/2026</t></is></c><c r="B2" t="inlineStr"><is><t>Recebimento</t></is></c><c r="C2"><v>250</v></c><c r="D2"><v></v></c></row>
  </sheetData></worksheet>`;
  const archive = zipSync({ "xl/worksheets/sheet1.xml": strToU8(sheet) });
  const file = { name: "extrato.xlsx", size: archive.byteLength, arrayBuffer: async () => archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) };
  const preview = await parseFinancialFile(file);
  assert.equal(preview.format, "xlsx");
  assert.deepEqual(preview.rows.map((row) => [row.description, row.amount]), [["Recebimento", 250]]);
});

test("linhas inválidas são excluídas da confirmação e explicadas", async () => {
  const preview = await parseFinancialText("Data;Descrição;Valor\n31/08/2026;Válida;10,00\nsem-data;Inválida;20,00");
  assert.equal(preview.rows.length, 1);
  assert.equal(preview.errors.length, 1);
  assert.match(preview.errors[0], /Linha 3/);
});
