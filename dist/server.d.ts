/**
 * @fileoverview HTTP server and route handlers for config-driven knowledge dashboards.
 *
 * Flow: start options -> initial scan -> `/api/status`, `/api/entries`, `/api/entry-content`, and
 * static HTML responses.
 *
 * @testing Node test runner (tsx): npm run knowledge-dashboard-kit:test
 *
 * @see packages/knowledge-dashboard-kit/src/scan.ts - Artifact scanner that builds the in-memory entry index this server caches, refreshes on `/api/entries`, and reports counts through `/api/status`.
 * @see packages/knowledge-dashboard-kit/src/types.ts - Kit config, hook, and start-server option contracts that define realm URLs, HTML paths, and logging hooks consumed by these handlers.
 * @see scripts/knowledge-base-dashboard/server.ts - Root CLI adapter that resolves project context and starts `knowledgeDashboardKitStartServer` for local knowledge-base browsing.
 * @documentation reviewed=2026-05-22 standard=FILE_OVERVIEW_STANDARDS_TYPESCRIPT@3
 */
import { type Server } from "node:http";
import type { KnowledgeDashboardKit_Config, KnowledgeDashboardKit_StartServerOptions } from "./types.js";
/**
 * Computes the HTTPS realm URL advertised on a configured local router.
 *
 * @param options - Realm configuration and injected environment values.
 * @returns The advertised router URL; this does not automatically trust its Host.
 */
export declare function knowledgeDashboardKitBuildSubdomainUrl(options: {
    readonly config: KnowledgeDashboardKit_Config;
    readonly env: Record<string, string | undefined>;
}): string;
/**
 * Starts a loopback dashboard with scan-based content access and strict request validation.
 *
 * @param options - Trusted configuration, filesystem root, bind settings, and hooks.
 * @returns The HTTP server; callers own shutdown and server error handling.
 * @throws If an allowed Host, hidden collection name, or scan budget is invalid.
 */
export declare function knowledgeDashboardKitStartServer(options: KnowledgeDashboardKit_StartServerOptions): Server;
//# sourceMappingURL=server.d.ts.map