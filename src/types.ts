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

/** Dashboard entry kind used for filtering, counts, and icon classes. */
export type KnowledgeDashboardKit_CollectionType =
  | "studies"
  | "specs"
  | "plans"
  | "docs";

/** Dated-folder collection scanned from a project root. */
export type KnowledgeDashboardKit_CollectionConfig = {
  readonly type: Exclude<KnowledgeDashboardKit_CollectionType, "docs">;
  readonly dir: string;
  readonly color: string;
  readonly icon: string;
};

/** One docs root under a project tree with a short label for slugs and UI. */
export type KnowledgeDashboardKit_DocsSourceConfig = {
  readonly repoLabel: string;
  readonly dir: string;
};

/** Port resolution source used for operator logging and tests. */
export type KnowledgeDashboardKit_PortSource =
  | "cli"
  | "active-env"
  | "process-env"
  | "default";

/** Configures CLI/env/default precedence for the dashboard bind port. */
export type KnowledgeDashboardKit_PortConfig = {
  readonly defaultPort: number;
  readonly canonicalRealmSlug: string;
  readonly canonicalPortEnvName: string;
  readonly legacyPortEnvName?: string;
  readonly realmSlugEnvName: string;
  readonly portFlags: readonly string[];
  readonly errorPrefix: string;
};

/** Validated TCP port and its provenance. */
export type KnowledgeDashboardKit_ResolvedPort = {
  readonly port: number;
  readonly source: KnowledgeDashboardKit_PortSource;
};

/** Env-backed realm URL inputs used to print the router URL beside the direct URL. */
export type KnowledgeDashboardKit_RealmUrlConfig = {
  readonly subdomain: string;
  readonly realmSlugEnvName: string;
  readonly methodEnvName: string;
  readonly developerSlugEnvNames: readonly string[];
  readonly rootZoneEnvName: string;
  readonly listenPortEnvName: string;
  readonly defaultRealmSlug: string;
  readonly defaultMethod: string;
  readonly defaultDeveloperSlug: string;
  readonly defaultRootZone: string;
  readonly defaultListenPort: number;
};

/** Project-owned config consumed by reusable scanning and server helpers. */
export type KnowledgeDashboardKit_Config = {
  readonly title: string;
  readonly collections: readonly KnowledgeDashboardKit_CollectionConfig[];
  readonly docsSources: readonly KnowledgeDashboardKit_DocsSourceConfig[];
  readonly githubRepo: string;
  readonly githubBranch: string;
  readonly htmlFilePath: string;
  readonly port: KnowledgeDashboardKit_PortConfig;
  readonly realmUrl: KnowledgeDashboardKit_RealmUrlConfig;
};

/** Injectable inputs for port resolution without mutating process globals. */
export type KnowledgeDashboardKit_ResolvePortOptions = {
  readonly activeEnvFilePaths: readonly string[];
  readonly argv: readonly string[];
  readonly config: KnowledgeDashboardKit_PortConfig;
  readonly env: Record<string, string | undefined>;
};

/** One indexed artifact row serialized to `/api/entries` for the dashboard UI. */
export type KnowledgeDashboardKit_Entry = {
  readonly type: KnowledgeDashboardKit_CollectionType;
  readonly slug: string;
  readonly title: string;
  readonly date: string;
  readonly status: string;
  readonly fileCount: number;
  readonly mainFile: string | null;
  readonly files: readonly string[];
  readonly dirPath: string;
  readonly githubUrl: string;
  readonly crossRefs: readonly string[];
  readonly repo?: string;
  readonly searchText: string;
};

/** Full scan response returned from `/api/entries`. */
export type KnowledgeDashboardKit_ScanResult = {
  readonly entries: readonly KnowledgeDashboardKit_Entry[];
  readonly scannedAt: string;
  readonly counts: Record<KnowledgeDashboardKit_CollectionType, number>;
};

/** Minimal request log record emitted by the reusable HTTP server. */
export type KnowledgeDashboardKit_RequestLogRecord = {
  readonly durationMs: number;
  readonly host: string | string[] | undefined;
  readonly method: string | undefined;
  readonly path: string | undefined;
  readonly statusCode: number;
  readonly statusText: string;
  readonly surfaceId: string;
};

/** Server output and request logging hooks supplied by root adapters. */
export type KnowledgeDashboardKit_ServerHooks = {
  readonly log: (line: string) => void;
  readonly error: (line: string, error?: unknown) => void;
  readonly requestLog?: (record: KnowledgeDashboardKit_RequestLogRecord) => void;
};

/** Starts the dashboard server with explicit config and host hooks. */
export type KnowledgeDashboardKit_StartServerOptions = {
  readonly config: KnowledgeDashboardKit_Config;
  readonly env: Record<string, string | undefined>;
  readonly hooks?: Partial<KnowledgeDashboardKit_ServerHooks>;
  readonly port: number;
  readonly projectRoot: string;
};
