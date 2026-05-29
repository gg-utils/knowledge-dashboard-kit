/**
 * @fileoverview Verifies knowledge dashboard bind-port resolution precedence, canonical default
 * stability, and non-canonical realm safety for `knowledgeDashboardKitResolvePort`.
 *
 * This file owns regression coverage for CLI-vs-env ordering, explicit process-env overrides, and
 * the refusal path when a non-root realm would inherit the canonical default port.
 * Flow: write temp `.env.runtime` under tracked temp dirs -> call resolver -> assert port/source or thrown message -> `afterEach` removes temp trees.
 *
 * @example
 * ```typescript
 * test("CLI port wins over env file", () => {
 *   assert.deepEqual(
 *     knowledgeDashboardKitResolvePort({
 *       activeEnvFilePaths: [envFilePath],
 *       argv: ["--knowledge-base-port", "19112"],
 *       config: knowledgeDashboardKitTestConfig.port,
 *       env: { RUNTIME_REALM_SLUG: "branch-02" },
 *     }),
 *     { port: 19112, source: "cli" },
 *   );
 * });
 * ```
 *
 * @testing Node test runner (tsx): npm run knowledge-dashboard-kit:test from the repository root runs the package `tsx --test` harness that includes packages/knowledge-dashboard-kit/src/port-config.unit.test.ts alongside sibling `*.unit.test.ts` files.
 *
 * @see packages/knowledge-dashboard-kit/src/port-config.ts - Bind-port resolver, env parsing, and realm safety rules that this suite exercises end-to-end with temp env files and injected argv/env maps.
 * @see packages/knowledge-dashboard-kit/src/test-config.unit.ts - Shared fixture supplying port flags, realm slug env names, and canonical defaults wired into every resolver call in this file.
 * @see packages/knowledge-dashboard-kit/src/index.ts - Package barrel that re-exports `knowledgeDashboardKitResolvePort` so dashboard scripts share the same binding contract asserted here.
 * @documentation reviewed=2026-05-22 standard=FILE_OVERVIEW_STANDARDS_TYPESCRIPT@3
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";

import { knowledgeDashboardKitResolvePort } from "./port-config.js";
import { knowledgeDashboardKitTestConfig } from "./test-config.unit.js";

const tempDirs: string[] = [];

function writeTempEnvFile(content: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-dashboard-kit-"));
  tempDirs.push(tempDir);
  const envFilePath = path.join(tempDir, ".env.runtime");
  fs.writeFileSync(envFilePath, content, "utf8");
  return envFilePath;
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
});

test("knowledgeDashboardKitResolvePort uses CLI port before env files", () => {
  const envFilePath = writeTempEnvFile(
    "RUNTIME_REALM_SLUG=branch-02\nRUNTIME_KNOWLEDGE_PORT=19012\n",
  );

  assert.deepEqual(
    knowledgeDashboardKitResolvePort({
      activeEnvFilePaths: [envFilePath],
      argv: ["--knowledge-base-port", "19112"],
      config: knowledgeDashboardKitTestConfig.port,
      env: { RUNTIME_REALM_SLUG: "branch-02" },
    }),
    { port: 19112, source: "cli" },
  );
});

test("knowledgeDashboardKitResolvePort rejects non-canonical default inheritance", () => {
  const envFilePath = writeTempEnvFile(
    "RUNTIME_REALM_SLUG=branch-02\nRUNTIME_KNOWLEDGE_PORT=9012\n",
  );

  assert.throws(
    () =>
      knowledgeDashboardKitResolvePort({
        activeEnvFilePaths: [envFilePath],
        argv: [],
        config: knowledgeDashboardKitTestConfig.port,
        env: { RUNTIME_REALM_SLUG: "branch-02" },
      }),
    /Refusing to bind non-canonical realm 'branch-02'/,
  );
});

test("knowledgeDashboardKitResolvePort accepts explicit non-root process env port", () => {
  const envFilePath = writeTempEnvFile("RUNTIME_REALM_SLUG=branch-02\n");

  assert.deepEqual(
    knowledgeDashboardKitResolvePort({
      activeEnvFilePaths: [envFilePath],
      argv: [],
      config: knowledgeDashboardKitTestConfig.port,
      env: {
        RUNTIME_REALM_SLUG: "branch-02",
        RUNTIME_KNOWLEDGE_PORT: "19112",
      },
    }),
    { port: 19112, source: "process-env" },
  );
});

test("knowledgeDashboardKitResolvePort keeps canonical default stable", () => {
  assert.deepEqual(
    knowledgeDashboardKitResolvePort({
      activeEnvFilePaths: [],
      argv: [],
      config: knowledgeDashboardKitTestConfig.port,
      env: { RUNTIME_REALM_SLUG: "main" },
    }),
    { port: 9012, source: "default" },
  );
});
