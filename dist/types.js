/**
 * @fileoverview Shared TypeScript contracts for the knowledge dashboard kit: collections, bind-port
 * resolution inputs, realm URL defaults, scan payloads, server hooks, and request-log records.
 *
 * Flow: project config + project root -> markdown scan -> JSON API rows and HTML server.
 *
 * @example
 * ```typescript
 * import type {
 *   KnowledgeDashboardKit_Config,
 *   KnowledgeDashboardKit_Entry,
 * } from "@gg-utils/knowledge-dashboard-kit/types";
 * ```
 *
 * @testing Node test runner (tsx): npm run knowledge-dashboard-kit:test
 *
 * @see packages/knowledge-dashboard-kit/src/scan.ts - Markdown scanner that consumes `KnowledgeDashboardKit_Config`, entry shapes, and `KnowledgeDashboardKit_ScanResult` when building the `/api/entries` payload.
 * @see packages/knowledge-dashboard-kit/src/server.ts - HTTP server surface that threads `KnowledgeDashboardKit_Config`, `KnowledgeDashboardKit_StartServerOptions`, and logging hooks typed here.
 * @see packages/knowledge-dashboard-kit/src/port-config.ts - Port-resolution helpers that read `KnowledgeDashboardKit_ResolvePortOptions` and `KnowledgeDashboardKit_PortConfig` defined in this module.
 * @see knowledge-dashboard.config.ts - Repo-root dashboard config object whose fields are shaped to satisfy `KnowledgeDashboardKit_Config` when adapters wire the kit into local servers.
 * @documentation reviewed=2026-05-22 standard=FILE_OVERVIEW_STANDARDS_TYPESCRIPT@3
 */
export {};
//# sourceMappingURL=types.js.map