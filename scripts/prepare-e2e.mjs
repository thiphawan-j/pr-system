#!/usr/bin/env node

import { spawnSync } from "node:child_process";

import "dotenv/config";

import { assertDisposableSeedTarget } from "../prisma/seed-safety.ts";

// Validate before db push --accept-data-loss as well as the seed subprocess.
const databaseUrl = assertDisposableSeedTarget(process.env);
if (!new URL(databaseUrl).pathname.endsWith("_e2e")) {
  throw new Error("E2E setup requires an explicitly confirmed disposable _e2e database.");
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function run(args) {
  const result = spawnSync(npmCommand, args, {
    env: process.env,
    stdio: "inherit",
  });

  if (result.signal) {
    process.kill(process.pid, result.signal);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run(["exec", "--", "prisma", "db", "push", "--accept-data-loss"]);
run(["run", "db:seed"]);
