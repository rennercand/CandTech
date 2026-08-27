import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  attachmentContentDisposition,
  exportFileNameError,
  safeExportFilename,
} from "../lib/export-filename.js";

test("mantém nome legível e adiciona uma única extensão", () => {
  assert.equal(safeExportFilename("Relatório agosto.pdf", "pdf"), "Relatório agosto.pdf");
  assert.equal(safeExportFilename("Estoque da loja", "xlsx"), "Estoque da loja.xlsx");
});

test("remove travessia, controles e nomes reservados", () => {
  const filename = safeExportFilename("../../segredo\r\nX-Test: sim", "csv");
  assert.equal(/[\\/\r\n]/.test(filename), false);
  assert.equal(filename.endsWith(".csv"), true);
  assert.equal(safeExportFilename("CON", "pdf", "relatorio"), "relatorio.pdf");
  assert.match(exportFileNameError("pasta/arquivo"), /não pode conter/);
});

test("Content-Disposition não permite injeção de cabeçalho e preserva UTF-8", () => {
  const header = attachmentContentDisposition("Relatório mês.pdf\r\nX-Evil: 1");
  assert.equal(header.includes("\r"), false);
  assert.equal(header.includes("\n"), false);
  assert.match(header, /filename\*=UTF-8''/);
});

test("interface usa uma janela acessível em todas as áreas de exportação", async () => {
  const [dialog, app, inventory] = await Promise.all([
    readFile(new URL("../app/file-name-dialog.js", import.meta.url), "utf8"),
    readFile(new URL("../app/candtech-app.js", import.meta.url), "utf8"),
    readFile(new URL("../app/inventory-operations.js", import.meta.url), "utf8"),
  ]);
  assert.match(dialog, /Coloque o nome do arquivo/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(app, /requestFileName/);
  assert.match(inventory, /requestFileName/);
});
