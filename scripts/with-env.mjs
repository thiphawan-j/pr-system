#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const aliases = {
  development: "dev",
  local: "dev",
  preview: "uat",
  production: "prod",
  staging: "uat",
};
const validEnvironments = new Set(["dev", "uat", "prod"]);
const requestedEnvironment = process.argv[2];
const environment = aliases[requestedEnvironment] ?? requestedEnvironment;
const separatorIndex = process.argv.indexOf("--");

if (!environment || !validEnvironments.has(environment) || separatorIndex === -1) {
  console.error(
    "Usage: node scripts/with-env.mjs <dev|uat|prod> -- <command> [...args]",
  );
  process.exit(1);
}

const command = process.argv[separatorIndex + 1];
const args = process.argv.slice(separatorIndex + 2);

if (!command) {
  console.error("Missing command after --");
  process.exit(1);
}

const root = process.cwd();
const hostProvidedKeys = new Set(Object.keys(process.env));

function parseEnvValue(value) {
  const trimmed = value.trim();
  const quote = trimmed[0];

  if ((quote === "\"" || quote === "'") && trimmed.endsWith(quote)) {
    const unquoted = trimmed.slice(1, -1);
    return quote === "\"" ? unquoted.replace(/\\n/g, "\n") : unquoted;
  }

  return trimmed;
}

function loadEnvFile(fileName) {
  const filePath = path.join(root, fileName);

  if (!existsSync(filePath)) {
    return;
  }

  const content = readFileSync(filePath, "utf8");

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const normalizedLine = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separator = normalizedLine.indexOf("=");

    if (separator === -1) {
      continue;
    }

    const key = normalizedLine.slice(0, separator).trim();

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || hostProvidedKeys.has(key)) {
      continue;
    }

    process.env[key] = parseEnvValue(normalizedLine.slice(separator + 1));
  }
}

loadEnvFile(".env");
loadEnvFile(`.env.${environment}`);
loadEnvFile(`.env.${environment}.local`);

process.env.APP_ENV ??= environment;

const child = spawn(command, args, {
  env: process.env,
  shell: process.platform === "win32",
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
