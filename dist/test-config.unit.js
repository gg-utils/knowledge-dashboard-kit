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
import path from "node:path";
import { fileURLToPath } from "node:url";
const currentDir = path.dirname(fileURLToPath(import.meta.url));
/**
 * Canonical typed dashboard configuration reused across package unit tests.
 *
 * @remarks
 * Labels (`runtime`, `example/runtime`) are synthetic placeholders for harness-only scans and
 * GitHub metadata fields; they are not production deployment identifiers.
 */
export const knowledgeDashboardKitTestConfig = {
    title: "Runtime Knowledge Dashboard",
    collections: [
        { type: "studies", dir: ".studies", color: "#60a5fa", icon: "microscope" },
        { type: "specs", dir: ".specs", color: "#8b5cf6", icon: "clipboard" },
        { type: "plans", dir: ".plans", color: "#34d399", icon: "map" },
    ],
    docsSources: [{ repoLabel: "runtime", dir: "docs" }],
    githubRepo: "example/runtime",
    githubBranch: "main",
    htmlFilePath: path.join(currentDir, "..", "assets", "index.html"),
    port: {
        defaultPort: 9012,
        canonicalRealmSlug: "main",
        canonicalPortEnvName: "RUNTIME_KNOWLEDGE_PORT",
        legacyPortEnvName: "KNOWLEDGE_DASHBOARD_PORT",
        realmSlugEnvName: "RUNTIME_REALM_SLUG",
        portFlags: ["--port", "--knowledge-base-port"],
        errorPrefix: "[knowledge-base]",
    },
    realmUrl: {
        subdomain: "knowledge-base",
        realmSlugEnvName: "RUNTIME_REALM_SLUG",
        methodEnvName: "RUNTIME_METHOD",
        developerSlugEnvNames: ["RUNTIME_DEVELOPER", "USER"],
        rootZoneEnvName: "RUNTIME_ROOT_ZONE",
        listenPortEnvName: "RUNTIME_LISTEN_PORT",
        defaultRealmSlug: "main",
        defaultMethod: "router",
        defaultDeveloperSlug: "dev",
        defaultRootZone: "example.test",
        defaultListenPort: 443,
    },
};
//# sourceMappingURL=test-config.unit.js.map