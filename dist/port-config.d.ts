/**
 * @fileoverview Config-driven bind-port resolution for knowledge dashboard helper servers.
 *
 * Flow: CLI args -> active env file -> process env -> configured default, with non-canonical realm
 * safety checks driven entirely by caller-provided config.
 *
 * @testing Node test runner: npm run knowledge-dashboard-kit:test
 *
 * @see packages/knowledge-dashboard-kit/src/port-config.unit.test.ts - Node tests covering CLI precedence, env-file and process-env resolution, and non-canonical realm collision guards for the helpers exported here.
 * @see scripts/knowledge-base-dashboard/server.ts - Local knowledge dashboard HTTP server that calls `knowledgeDashboardKitResolvePort` from this kit to pick its bind port.
 * @see packages/knowledge-dashboard-kit/src/types.ts - `KnowledgeDashboardKit_ResolvePortOptions` and resolved-port types consumed by the exported resolution helpers in this module.
 * @documentation reviewed=2026-05-22 standard=FILE_OVERVIEW_STANDARDS_TYPESCRIPT@3
 */
import type { KnowledgeDashboardKit_ResolvedPort, KnowledgeDashboardKit_ResolvePortOptions } from "./types.js";
/** Parses a non-empty decimal port string and enforces the TCP port range. */
export declare function knowledgeDashboardKitParsePositivePort(options: {
    readonly errorPrefix: string;
    readonly label: string;
    readonly rawValue: string;
}): number;
/** Normalizes a raw `.env` value segment by trimming and removing one wrapping quote pair. */
export declare function knowledgeDashboardKitStripEnvValue(rawValue: string): string;
/** Scans a local env file for a `KEY=value` assignment when the path exists. */
export declare function knowledgeDashboardKitReadEnvFileValue(options: {
    readonly envFilePath: string | null;
    readonly key: string;
}): string | null;
/** Resolves the dashboard bind port from CLI flags, active env files, process env, or defaults. */
export declare function knowledgeDashboardKitResolvePort(options: KnowledgeDashboardKit_ResolvePortOptions): KnowledgeDashboardKit_ResolvedPort;
//# sourceMappingURL=port-config.d.ts.map