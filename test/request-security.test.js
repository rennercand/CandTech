import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { readLimitedJson, RequestBodyError } from "../lib/request-security.js";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function routeFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.name === "route.js" ? [path] : [];
  });
}

test("leitor JSON aceita corpo pequeno e rejeita excesso mesmo sem Content-Length", async () => {
  const valid = new Request("http://localhost/api", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "a@b.com" }),
  });
  assert.deepEqual(await readLimitedJson(valid, { maxBytes: 128 }), { email: "a@b.com" });

  const oversized = new Request("http://localhost/api", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: "x".repeat(200) }),
  });
  await assert.rejects(() => readLimitedJson(oversized, { maxBytes: 64 }), (error) => error instanceof RequestBodyError && error.status === 413);
});

test("leitor JSON limita profundidade e chaves perigosas", async () => {
  const deep = new Request("http://localhost/api", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ a: { b: { c: 1 } } }),
  });
  await assert.rejects(() => readLimitedJson(deep, { maxDepth: 1 }), RequestBodyError);

  const unsafe = new Request("http://localhost/api", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: '{"constructor":"blocked"}',
  });
  await assert.rejects(() => readLimitedJson(unsafe), RequestBodyError);
});

test("toda API privada exige sessão JWT no servidor", () => {
  const publicRoutes = new Set([
    join("app", "api", "auth", "login", "route.js"),
    join("app", "api", "auth", "register", "route.js"),
  ]);
  for (const file of routeFiles(join(projectRoot, "app", "api"))) {
    const route = relative(projectRoot, file);
    if (publicRoutes.has(route)) continue;
    const source = readFileSync(file, "utf8");
    assert.match(source, /getSession\s*\(/, `${route} precisa validar a sessão JWT`);
  }
});
