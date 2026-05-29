/**
 * @fileoverview Verifies knowledge-dashboard markdown scanning: collection indexing, frontmatter
 * titles, docs slugs, and inline cross-reference extraction for studies.
 *
 * This file owns Node test regression coverage for knowledgeDashboardKitScanAll using ephemeral
 * fixture trees under a temporary project root plus the shared package test config.
 * Flow: temp project root -> write study/docs markdown fixtures -> scan -> assert counts, titles, slugs, and crossRefs.
 *
 * @testing Node test runner (tsx): npm run knowledge-dashboard-kit:test
 *
 * @see packages/knowledge-dashboard-kit/src/scan.ts - Synchronous scanner implementation under test that walks configured collections and docs sources to produce entries and counts.
 * @see packages/knowledge-dashboard-kit/src/test-config.unit.ts - Shared knowledgeDashboardKitTestConfig fixture wired into knowledgeDashboardKitScanAll calls in this suite.
 * @see docs/TYPESCRIPT_STANDARDS_DOCUMENTATION_FILE_OVERVIEWS.md - Repository file-overview contract this header follows for verification and cross-file orientation.
 * @documentation reviewed=2026-05-22 standard=FILE_OVERVIEW_STANDARDS_TYPESCRIPT@3
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";

import { knowledgeDashboardKitScanAll } from "./scan.js";
import { knowledgeDashboardKitTestConfig } from "./test-config.unit.js";

const tempDirs: string[] = [];

function makeProjectRoot(): string {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-dashboard-scan-"));
  tempDirs.push(projectRoot);
  return projectRoot;
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
});

test("knowledgeDashboardKitScanAll indexes collections and docs sources", () => {
  const projectRoot = makeProjectRoot();
  const studyDir = path.join(projectRoot, ".studies", "2026-05-20-runtime-study");
  const docsDir = path.join(projectRoot, "docs", "operators");
  fs.mkdirSync(studyDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(
    path.join(studyDir, "study-runtime.md"),
    [
      "---",
      "title: Runtime Study",
      "status: final",
      "date: 2026-05-20",
      "---",
      "See .plans/2026-05-20-runtime-plan/plan.md",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(docsDir, "README.md"),
    ["---", "title: Operator Guide", "---", "Body"].join("\n"),
    "utf8",
  );

  const result = knowledgeDashboardKitScanAll({
    config: knowledgeDashboardKitTestConfig,
    logger: { error: () => {} },
    projectRoot,
  });

  assert.equal(result.counts.studies, 1);
  assert.equal(result.counts.docs, 1);
  const study = result.entries.find((entry) => entry.type === "studies");
  assert.equal(study?.title, "Runtime Study");
  assert.deepEqual(study?.crossRefs, [".plans/2026-05-20-runtime-plan/plan.md"]);
  const docs = result.entries.find((entry) => entry.type === "docs");
  assert.equal(docs?.slug, "runtime/operators");
  assert.equal(docs?.title, "Operator Guide");
});
