import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const revision = process.argv[2] || "HEAD";
const commit = spawnSync("git", ["rev-parse", "--verify", revision], { encoding: "utf8" });
if (commit.status !== 0) throw new Error(`Revisão Git inválida: ${revision}`);
const archive = spawnSync("git", ["archive", "--format=tar", revision], { encoding: null, maxBuffer: 200 * 1024 * 1024 });
if (archive.status !== 0) throw new Error(String(archive.stderr || "Não foi possível gerar o arquivo técnico."));
const sha256 = createHash("sha256").update(archive.stdout).digest("hex");
console.log(JSON.stringify({ revision, commit: commit.stdout.trim(), algorithm: "SHA-256", sha256, bytes: archive.stdout.length }, null, 2));
