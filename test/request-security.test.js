import test from "node:test";
import assert from "node:assert/strict";
import { readLimitedJson, RequestBodyError } from "../lib/request-security.js";

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
