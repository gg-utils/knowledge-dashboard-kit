/**
 * @fileoverview Shared `KnowledgeDashboardKit_Config` fixture for `knowledge-dashboard-kit` unit
 * harnesses.
 *
 * This file owns the canonical typed test configuration (collections, docs roots, port binding,
 * realm URL defaults) imported by sibling `*.unit.test.ts` suites so resolver and scan tests share
 * one stable argv/env and HTML asset path contract.
 * Flow: resolve `import.meta.url` dirname -> join dashboard `assets/index.html` -> export frozen config object.
 *
 * @testing Node test runner (tsx): npm run knowledge-dashboard-kit:test from the repository root runs the package `tsx --test` harness that loads this module through packages/knowledge-dashboard-kit/src/*.unit.test.ts suites alongside port and scan coverage.
 *
 * @see packages/knowledge-dashboard-kit/src/types.ts - Declares `KnowledgeDashboardKit_Config` and related port/realm shapes this fixture satisfies so tests exercise the same contract as production callers.
 * @see packages/knowledge-dashboard-kit/src/port-config.unit.test.ts - Port resolver regression suite that injects `knowledgeDashboardKitTestConfig.port` into `knowledgeDashboardKitResolvePort` calls with temp env files and argv maps.
 * @see packages/knowledge-dashboard-kit/src/scan.unit.test.ts - Artifact scan suite that passes the full exported config into `knowledgeDashboardKitScanAll` to validate directory wiring against this fixture.
 * @documentation reviewed=2026-05-22 standard=FILE_OVERVIEW_STANDARDS_TYPESCRIPT@3
 */
import type { KnowledgeDashboardKit_Config } from "./types.js";
/**
 * Canonical typed dashboard configuration reused across package unit tests.
 *
 * @remarks
 * Labels (`runtime`, `example/runtime`) are synthetic placeholders for harness-only scans and
 * GitHub metadata fields; they are not production deployment identifiers.
 */
export declare const knowledgeDashboardKitTestConfig: KnowledgeDashboardKit_Config;
//# sourceMappingURL=test-config.unit.d.ts.map