import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { assertDisposableSeedTarget } from "../../prisma/seed-safety";

const safe = {
  NODE_ENV: "test", DATABASE_URL: "postgresql://tester:secret@localhost:5433/pr_management_e2e?schema=public",
  SEED_ALLOW_RESET: "RESET_DISPOSABLE_DATABASE", SEED_DISPOSABLE_DATABASE: "pr_management_e2e",
} as const;
const blocked = (env: Record<string, string | undefined>) => assert.throws(() => assertDisposableSeedTarget(env), /Destructive demo seed blocked/);

test("requires explicit environment, reset phrase, exact database confirmation and URL", () => {
  blocked({});
  for (const key of Object.keys(safe)) {
    const env: Record<string, string | undefined> = { ...safe }; delete env[key]; blocked(env);
  }
  for (const NODE_ENV of ["production", "staging", "Test", ""]) blocked({ ...safe, NODE_ENV });
  for (const APP_ENV of ["prod", "production", "uat", "staging", "unknown"]) blocked({ ...safe, APP_ENV });
  for (const SEED_ALLOW_RESET of ["true", "1", "RESET_DISPOSABLE_DATABASE "]) blocked({ ...safe, SEED_ALLOW_RESET });
  blocked({ ...safe, SEED_DISPOSABLE_DATABASE: "other_e2e" });
});

test("allows only explicitly confirmed local disposable targets", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    for (const NODE_ENV of ["test", "development"]) {
      const DATABASE_URL = `postgresql://tester:secret@${host}:5433/pr_management_e2e?schema=public`;
      assert.equal(assertDisposableSeedTarget({ ...safe, DATABASE_URL, NODE_ENV }), DATABASE_URL);
    }
  }
  const DATABASE_URL = "postgres://localhost/sandbox_test";
  assert.equal(assertDisposableSeedTarget({ ...safe, DATABASE_URL, SEED_DISPOSABLE_DATABASE: "sandbox_test" }), DATABASE_URL);
});

test("rejects remote, production-like, malformed and ambiguous connection targets", () => {
  for (const DATABASE_URL of [
    "not a url", "https://localhost/pr_management_e2e", "postgresql://db/pr_management_e2e",
    "postgresql://db.example.com/pr_management_e2e", "postgresql://localhost.evil.test/pr_management_e2e",
    "postgresql://localhost@remote.example/pr_management_e2e", "postgresql://localhost/pr_management",
    "postgresql://localhost/postgres", "postgresql://localhost/pr_management_e2e/other",
    "postgresql://localhost/%70r_management_e2e", "postgresql://localhost/pr_management_e2e#x",
    "postgresql://localhost/pr_management_e2e?host=remote.example", "postgresql://localhost/pr_management_e2e?database=production",
    "postgresql://localhost/pr_management_e2e?service=prod", "postgresql://localhost/pr_management_e2e?options=-csearch_path=production",
    "postgresql://localhost/pr_management_e2e?schema=other", "postgresql://localhost/pr_management_e2e?schema=public&schema=public",
    "postgresql://localhost/pr_management_e2e?sslmode=require", "postgresql://localhost/" + "a".repeat(64) + "_test",
  ]) blocked({ ...safe, DATABASE_URL });
});

test("blocked errors never disclose URL or credentials", () => {
  try { assertDisposableSeedTarget({ ...safe, NODE_ENV: "production" }); assert.fail(); }
  catch (error) { const message = String(error); assert.ok(!message.includes(safe.DATABASE_URL)); assert.ok(!message.includes(":secret@")); }
});

test("real seed entrypoint rejects production before any connection or deletion", () => {
  // An intentionally unreachable loopback port: even fully acknowledged production
  // must fail with the guard, never a connection error. This never runs the seed.
  const result = spawnSync(process.execPath, ["--import", "tsx", "prisma/seed.ts"], {
    encoding: "utf8", timeout: 10000,
    env: { ...process.env, ...safe, NODE_ENV: "production", DATABASE_URL: "postgresql://tester:secret@127.0.0.1:1/pr_management_e2e" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Destructive demo seed blocked/);
  assert.doesNotMatch(result.stderr, /ECONNREFUSED|Authentication failed|:secret@/);
  const source = readFileSync("prisma/seed.ts", "utf8");
  assert.ok(source.indexOf("assertDisposableSeedTarget(process.env)") < source.indexOf("new PrismaClient"));
  assert.ok(source.indexOf("assertDisposableSeedTarget(process.env)") < source.indexOf("new Pool"));
});


test("E2E preparation refuses before destructive db push or seed", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/prepare-e2e.mjs"], {
    encoding: "utf8", timeout: 10000,
    env: { ...process.env, ...safe, APP_ENV: "prod", DATABASE_URL: "postgresql://tester:secret@127.0.0.1:1/pr_management_e2e" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Destructive demo seed blocked/);
  assert.doesNotMatch(result.stderr + result.stdout, /ECONNREFUSED|prisma db push|:secret@/);
});
