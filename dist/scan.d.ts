/**
 * @fileoverview Markdown collection and docs-source scanner for knowledge dashboards.
 *
 * Flow: config + project root -> best-effort synchronous markdown index -> entries/counts payload.
 *
 * @testing Node test runner (tsx): npm run knowledge-dashboard-kit:test
 *
 * @see packages/knowledge-dashboard-kit/src/types.ts - Config, collection, entry, and scan-result types consumed when walking filesystem trees and assembling indexed payloads.
 * @see packages/knowledge-dashboard-kit/src/server.ts - Local dashboard HTTP server that invokes knowledgeDashboardKitScanAll to refresh the in-memory artifact index on demand.
 * @see packages/knowledge-dashboard-kit/src/scan.unit.test.ts - Node test coverage that exercises knowledgeDashboardKitScanAll against temporary fixture directories under the repo contract.
 * @documentation reviewed=2026-05-22 standard=FILE_OVERVIEW_STANDARDS_TYPESCRIPT@3
 */
import type { KnowledgeDashboardKit_CollectionConfig, KnowledgeDashboardKit_Config, KnowledgeDashboardKit_DocsSourceConfig, KnowledgeDashboardKit_Entry, KnowledgeDashboardKit_ScanResult } from "./types.js";
/** Minimal logger surface used by scanner helpers. */
export type KnowledgeDashboardKit_ScanLogger = {
    readonly error: (line: string, error?: unknown) => void;
};
/** Parses the first `---` fence in markdown into simple string key/value pairs. */
export declare function knowledgeDashboardKitParseFrontmatter(content: string): Record<string, string>;
/** Builds a compact plain-text preview for client-side search after dropping frontmatter. */
export declare function knowledgeDashboardKitExtractSearchText(options: {
    readonly content: string;
    readonly maxLength?: number;
}): string;
/** Walks one dated-folder collection under the project root. */
export declare function knowledgeDashboardKitScanCollection(options: {
    readonly collection: KnowledgeDashboardKit_CollectionConfig;
    readonly config: KnowledgeDashboardKit_Config;
    readonly logger?: KnowledgeDashboardKit_ScanLogger;
    readonly projectRoot: string;
}): KnowledgeDashboardKit_Entry[];
/** Indexes markdown under a single docs source. */
export declare function knowledgeDashboardKitScanDocsSource(options: {
    readonly config: KnowledgeDashboardKit_Config;
    readonly logger?: KnowledgeDashboardKit_ScanLogger;
    readonly projectRoot: string;
    readonly source: KnowledgeDashboardKit_DocsSourceConfig;
}): KnowledgeDashboardKit_Entry[];
/** Refreshes the full in-memory index for all configured collections and docs sources. */
export declare function knowledgeDashboardKitScanAll(options: {
    readonly config: KnowledgeDashboardKit_Config;
    readonly logger?: KnowledgeDashboardKit_ScanLogger;
    readonly projectRoot: string;
}): KnowledgeDashboardKit_ScanResult;
//# sourceMappingURL=scan.d.ts.map