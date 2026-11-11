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
/**
 * Parses a non-empty decimal port string and enforces the TCP port range.
 *
 * @param options - Raw port value and error-label context.
 * @returns A validated port from 1 through 65535.
 * @throws If the input is not a decimal port in the valid range.
 */
export declare function knowledgeDashboardKitParsePositivePort(options: {
    readonly errorPrefix: string;
    readonly label: string;
    readonly rawValue: string;
}): number;
/**
 * Normalizes a raw `.env` value segment by trimming and removing one wrapping quote pair.
 *
 * @param rawValue - Assignment value to normalize.
 * @returns The trimmed value with a matching outer quote pair removed.
 */
export declare function knowledgeDashboardKitStripEnvValue(rawValue: string): string;
/**
 * Scans a local env file for a `KEY=value` assignment when the path exists.
 *
 * @param options - Explicitly selected configuration file and assignment key.
 * @returns The last matching value, or null when the file or key is absent.
 * @throws If the selected file cannot be read.
 */
export declare function knowledgeDashboardKitReadEnvFileValue(options: {
    readonly envFilePath: string | null;
    readonly key: string;
}): string | null;
/**
 * Resolves the dashboard bind port from CLI flags, active env files, process env, or defaults.
 *
 * @param options - Explicit configuration, arguments, environment, and active file paths.
 * @returns The validated port and its resolution source.
 * @throws If a port is invalid or a non-canonical realm would inherit an unsafe default.
 */
export declare function knowledgeDashboardKitResolvePort(options: KnowledgeDashboardKit_ResolvePortOptions): KnowledgeDashboardKit_ResolvedPort;
//# sourceMappingURL=port-config.d.ts.map