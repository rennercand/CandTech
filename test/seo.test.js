import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { HOME_DESCRIPTION, HOME_META_TITLE, SITE_URL } from "../lib/site.js";

const projectRoot = process.cwd();

test("página inicial mantém os sinais essenciais verificados pelo Screaming Frog", () => {
  const publicHome = readFileSync(join(projectRoot, "app", "public-home.js"), "utf8");
  const page = readFileSync(join(projectRoot, "app", "page.js"), "utf8");

  assert.ok(HOME_META_TITLE.length >= 30 && HOME_META_TITLE.length <= 60);
  assert.ok(HOME_DESCRIPTION.length >= 120 && HOME_DESCRIPTION.length <= 160);
  assert.equal(SITE_URL, "https://www.candtech.com.br");
  assert.equal((publicHome.match(/<h1\b/g) || []).length, 1);
  assert.ok((publicHome.match(/<h2\b/g) || []).length >= 2);
  assert.ok((publicHome.match(/href="(?:\/|#)/g) || []).length >= 5);
  assert.match(page, /alternates:\s*\{ canonical: SITE_URL \}/);
});

test("política de marca está ligada aos termos, rodapé e sitemap", () => {
  const policy = readFileSync(join(projectRoot, "app", "propriedade-intelectual", "page.js"), "utf8");
  const terms = readFileSync(join(projectRoot, "app", "termos", "page.js"), "utf8");
  const publicHome = readFileSync(join(projectRoot, "app", "public-home.js"), "utf8");
  const sitemap = readFileSync(join(projectRoot, "app", "sitemap.js"), "utf8");

  assert.match(policy, /Uso da Marca/);
  assert.match(policy, /não equivale ao símbolo ® nem declara registro concedido/);
  assert.match(terms, /propriedade-intelectual/);
  assert.match(publicHome, /© 2026 CandTech/);
  assert.match(sitemap, /propriedade-intelectual/);
});

test("mapa do sistema apresenta áreas públicas e mantém módulos privados fora das URLs indexadas", () => {
  const systemMap = readFileSync(join(projectRoot, "app", "mapa-do-sistema", "page.js"), "utf8");
  const sitemap = readFileSync(join(projectRoot, "app", "sitemap.js"), "utf8");

  assert.match(systemMap, /Páginas abertas/);
  assert.match(systemMap, /Módulos da empresa/);
  assert.match(systemMap, /Disponível após login/);
  assert.match(sitemap, /mapa-do-sistema/);
  assert.doesNotMatch(sitemap, /\/api\//);
});

test("central administrativa não é indexada nem publicada no sitemap", () => {
  const adminPage = readFileSync(join(projectRoot, "app", "central", "[accessKey]", "page.js"), "utf8");
  const robots = readFileSync(join(projectRoot, "app", "robots.js"), "utf8");
  const sitemap = readFileSync(join(projectRoot, "app", "sitemap.js"), "utf8");
  assert.match(adminPage, /index:\s*false/);
  assert.match(adminPage, /isAdministrator/);
  assert.match(robots, /\/central\//);
  assert.doesNotMatch(sitemap, /central/);
});

test("página 404 própria orienta o retorno e respeita redução de movimento", () => {
  const notFound = readFileSync(join(projectRoot, "app", "not-found.js"), "utf8");
  const styles = readFileSync(join(projectRoot, "app", "globals.css"), "utf8");
  assert.match(notFound, /ERRO 404/);
  assert.match(notFound, /Voltar para a CandTech/);
  assert.match(notFound, /robots:\s*\{\s*index:\s*false/);
  assert.match(styles, /@keyframes not-found-arrive/);
  assert.match(styles, /@keyframes not-found-breathe/);
  assert.match(styles, /prefers-reduced-motion:[^)]+\)[\s\S]*?\.not-found-mark[\s\S]*?animation:\s*none/);
});
