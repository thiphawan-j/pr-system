#!/usr/bin/env node

import { spawnSync } from "node:child_process";

import "dotenv/config";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("E2E setup requires DATABASE_URL.");
  process.exit(1);
}

let databaseName;

try {
  const parsedUrl = new URL(databaseUrl);
  databaseName = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ""));
} catch {
  console.error("E2E setup requires a valid DATABASE_URL.");
  process.exit(1);
}

if (!databaseName.endsWith("_e2e")) {
  console.error(
    `Refusing to reset database "${databaseName}". E2E databases must end with "_e2e".`,
  );
  process.exit(1);
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
