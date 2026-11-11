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
/**
 * Parses the first `---` fence in markdown into simple string key/value pairs.
 *
 * @param content - UTF-8 Markdown text.
 * @returns Parsed string values, or an empty record when frontmatter is absent.
 */
export declare function knowledgeDashboardKitParseFrontmatter(content: string): Record<string, string>;
/**
 * Builds a compact plain-text preview for client-side search after dropping frontmatter.
 *
 * @param options - Document text and optional maximum preview length.
 * @returns A trimmed preview with line breaks collapsed.
 */
export declare function knowledgeDashboardKitExtractSearchText(options: {
    readonly content: string;
    readonly maxLength?: number;
}): string;
/**
 * Walks a single dated collection with its own bounded scan.
 * @param options - Collection, trusted configuration, root, and optional logger.
 * @returns Safe nonempty entries, or an empty list if the scan budget is exceeded.
 * @throws If hidden-root or budget configuration is invalid.
 */
export declare function knowledgeDashboardKitScanCollection(options: {
    readonly collection: KnowledgeDashboardKit_CollectionConfig;
    readonly config: KnowledgeDashboardKit_Config;
    readonly logger?: KnowledgeDashboardKit_ScanLogger;
    readonly projectRoot: string;
}): KnowledgeDashboardKit_Entry[];
/**
 * Walks a single docs source with its own bounded scan.
 * @param options - Source, trusted configuration, root, and optional logger.
 * @returns Safe nonempty entries, or an empty list if the scan budget is exceeded.
 * @throws If hidden-root or budget configuration is invalid.
 */
export declare function knowledgeDashboardKitScanDocsSource(options: {
    readonly config: KnowledgeDashboardKit_Config;
    readonly logger?: KnowledgeDashboardKit_ScanLogger;
    readonly projectRoot: string;
    readonly source: KnowledgeDashboardKit_DocsSourceConfig;
}): KnowledgeDashboardKit_Entry[];
/**
 * Refreshes the full bounded index and private scan-time filesystem identities.
 * @param options - Trusted configuration, root, and optional logger.
 * @returns Safe entries and counts, or an empty index with a path-free budget error.
 * @throws If hidden-root or budget configuration is invalid, before scanning begins.
 */
export declare function knowledgeDashboardKitScanAll(options: {
    readonly config: KnowledgeDashboardKit_Config;
    readonly logger?: KnowledgeDashboardKit_ScanLogger;
    readonly projectRoot: string;
}): KnowledgeDashboardKit_ScanResult;
//# sourceMappingURL=scan.d.ts.map