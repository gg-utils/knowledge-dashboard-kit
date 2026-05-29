/**
 * @fileoverview Public barrel for config-driven knowledge dashboard helpers.
 *
 * Keep project-specific content roots, helper ports, realm URL defaults, and static asset paths in
 * `knowledge-dashboard.config.ts`; this package owns reusable scanning, routing, and port logic.
 * Flow: consumers import named kit helpers -> optional config from `knowledge-dashboard.config.ts` ->
 * scan artifacts, resolve bind ports, and start the HTTP dashboard server.
 *
 * @example
 * ```typescript
 * import {
 *   knowledgeDashboardKitResolvePort,
 *   knowledgeDashboardKitStartServer,
 * } from "@gg-utils/knowledge-dashboard-kit";
 * ```
 *
 * @testing Node test runner (tsx): npm run knowledge-dashboard-kit:test
 *
 * @see knowledge-dashboard.config.ts - consumer artifact roots, helper-port env names, realm URL defaults, and static asset paths that pair with kit scanning and port resolution.
 * @see scripts/knowledge-base-dashboard/server.ts - Root CLI adapter that resolves helper-edge project context and starts the kit HTTP server using exports from this barrel.
 * @see packages/knowledge-dashboard-kit/src/server.ts - HTTP server construction and request routing implementation re-exported here alongside scan, port-config, and type surfaces.
 * @documentation reviewed=2026-05-22 standard=FILE_OVERVIEW_STANDARDS_TYPESCRIPT@3
 */
export * from "./port-config.js";
export * from "./scan.js";
export * from "./server.js";
export * from "./types.js";
//# sourceMappingURL=index.d.ts.map