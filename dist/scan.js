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
import fs from "node:fs";
import { knowledgeDashboardKitReadDocument, knowledgeDashboardKitHiddenRoots, knowledgeDashboardKitScanIdentities, knowledgeDashboardKitResolveSafePath, } from "./content-policy.js";
const DEFAULT_SCAN_LOGGER = {
    error: (line, error) => {
        if (error === undefined) {
            console.error(line);
            return;
        }
        console.error(line, error);
    },
};
/**
 * Parses the first `---` fence in markdown into simple string key/value pairs.
 *
 * @param content - UTF-8 Markdown text.
 * @returns Parsed string values, or an empty record when frontmatter is absent.
 */
export function knowledgeDashboardKitParseFrontmatter(content) {
    const result = {};
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (match === null) {
        return result;
    }
    const body = match[1];
    if (body === undefined) {
        return result;
    }
    for (const line of body.split("\n")) {
        const colonIndex = line.indexOf(":");
        if (colonIndex <= 0) {
            continue;
        }
        const key = line.slice(0, colonIndex).trim();
        let value = line.slice(colonIndex + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        result[key] = value;
    }
    return result;
}
/**
 * Builds a compact plain-text preview for client-side search after dropping frontmatter.
 *
 * @param options - Document text and optional maximum preview length.
 * @returns A trimmed preview with line breaks collapsed.
 */
export function knowledgeDashboardKitExtractSearchText(options) {
    return options.content
        .replace(/^---\n[\s\S]*?\n---\n?/, "")
        .slice(0, options.maxLength ?? 300)
        .replace(/\n+/g, " ")
        .trim();
}
/** Builds a GitHub tree URL for a configured repo/branch and repo-relative path. */
function knowledgeDashboardKitGithubTreeUrl(options) {
    return `https://github.com/${options.config.githubRepo}/tree/${options.config.githubBranch}/${options.repoRelativePath}`;
}
/** Finds the main markdown file for a dated collection entry. */
function knowledgeDashboardKitFindCollectionMainFile(files) {
    return (files.find((file) => file.startsWith("study-") ||
        file.startsWith("plan-") ||
        file.startsWith("spec-")) ??
        files.find((file) => file.endsWith(".md") && !file.startsWith("appendix-")) ??
        null);
}
/** Extracts collection date from frontmatter or slug. */
function knowledgeDashboardKitResolveCollectionDate(options) {
    const dateMatch = options.slug.match(/^(\d{4}-\d{2}-\d{2})/);
    return (options.frontmatter.created_at ??
        options.frontmatter.date ??
        (dateMatch === null ? "unknown" : dateMatch[1] ?? "unknown"));
}
/** Extracts markdown cross-reference paths to dated collections. */
function knowledgeDashboardKitExtractCrossRefs(content) {
    const refMatches = content.match(/\.(studies|specs|plans)\/[^\s)>\]"']+/g);
    return refMatches === null ? [] : [...new Set(refMatches)];
}
/** Internal sentinel distinguishes a fail-closed budget from inaccessible filesystem objects. */
class ScanBudgetExceeded extends Error {
}
/**
 * Validates configuration and creates a fresh scan budget.
 * @param options - Trusted configuration, root, and optional error logger.
 * @returns Independent per-scan state with validated hidden collection roots.
 * @throws If a budget is not a positive safe integer or a hidden root is invalid.
 */
function createScanContext(options) {
    const hiddenRoots = knowledgeDashboardKitHiddenRoots(options.config);
    const maxEntries = options.config.scanLimits?.maxEntries ?? 10_000;
    const maxTotalBytes = options.config.scanLimits?.maxTotalBytes ?? 64 * 1024 * 1024;
    if (![maxEntries, maxTotalBytes].every((value) => Number.isSafeInteger(value) && value > 0)) {
        throw new Error("Invalid scan budget.");
    }
    return { ...options, logger: options.logger ?? DEFAULT_SCAN_LOGGER, hiddenRoots,
        maxEntries, maxTotalBytes, documents: new Map(), bytes: 0, entries: 0 };
}
/**
 * Enumerates a safe exact-spelled directory without leaking filesystem error details.
 * @param context - Current scan state.
 * @param relative - Canonical root-relative directory.
 * @param hiddenRoots - Exceptions applicable to this collection or docs source.
 * @returns Directory entries, or an empty array on refusal or read failure.
 */
function directoryItems(context, relative, hiddenRoots) {
    const resolved = knowledgeDashboardKitResolveSafePath(context.projectRoot, relative, "directory", hiddenRoots);
    if (resolved === null)
        return [];
    try {
        return fs.readdirSync(resolved.realPath, { withFileTypes: true });
    }
    catch {
        context.logger.error("Failed to read document directory.");
        return [];
    }
}
/**
 * Reserves bytes before a single bounded read, preventing aggregate read-budget overrun.
 * @param context - Shared scan budget and filesystem root.
 * @param relative - Exact relative document path.
 * @param hiddenRoots - Validated exceptions for the collection being scanned.
 * @returns Safe text and identity, or null on filesystem refusal.
 * @throws If the next eligible document would exceed the byte budget.
 */
function scanDocument(context, relative, hiddenRoots) {
    const document = knowledgeDashboardKitReadDocument(context.projectRoot, relative, { hiddenRoots, beforeRead: (bytes) => {
            if (bytes > context.maxTotalBytes - context.bytes)
                throw new ScanBudgetExceeded();
            context.bytes += bytes;
        } });
    return document === null ? null : { ...document, hiddenRoots };
}
/**
 * Publishes a nonempty entry and records only its exact eligible document identities.
 * @param context - Shared entry budget and private identity map.
 * @param entry - Completed entry containing a nonempty document list.
 * @param documents - Safe documents read once to construct the entry.
 * @returns The entry for inclusion in the public scan payload.
 * @throws If publishing this entry would exceed the entry budget.
 */
function publishEntry(context, entry, documents) {
    if (++context.entries > context.maxEntries)
        throw new ScanBudgetExceeded();
    for (const [file, document] of documents) {
        context.documents.set(JSON.stringify([entry.dirPath, file]), {
            identity: document.identity, hiddenRoots: document.hiddenRoots,
        });
    }
    return entry;
}
/**
 * Reads only direct regular documents in a publishable entry; denied names never contribute text.
 * @param context - Shared scan state and budgets.
 * @param relative - Exact entry directory.
 * @param hiddenRoots - Validated exceptions for the current collection.
 * @returns A non-public map of safe filenames to bounded text and identities.
 * @throws When the scan byte budget would be exceeded.
 */
function bundleDocuments(context, relative, hiddenRoots) {
    const documents = new Map();
    for (const item of directoryItems(context, relative, hiddenRoots)) {
        if (!item.isFile())
            continue;
        const document = scanDocument(context, [relative, item.name].filter(Boolean).join("/"), hiddenRoots);
        if (document !== null)
            documents.set(item.name, document);
    }
    return documents;
}
/**
 * Scans a dated collection using the shared scan budgets and exact root exception.
 * @param context - Shared validated scan state.
 * @param collection - Configured collection root and entry kind.
 * @returns Nonempty entries whose files passed the shared read policy.
 * @throws When an aggregate scan budget is exceeded.
 */
function scanCollection(context, collection) {
    const relative = collection.dir === "." ? "" : collection.dir;
    const hiddenRoots = new Set(context.hiddenRoots.has(relative) ? [relative] : []);
    const entries = [];
    const slugs = directoryItems(context, relative, hiddenRoots)
        .filter((item) => item.isDirectory() && !item.name.startsWith(".") && !item.name.startsWith("_"))
        .map((item) => item.name).sort().reverse();
    for (const slug of slugs) {
        const dirPath = [relative, slug].filter(Boolean).join("/");
        const documents = bundleDocuments(context, dirPath, hiddenRoots);
        const files = [...documents.keys()];
        if (files.length === 0)
            continue;
        const mainFile = knowledgeDashboardKitFindCollectionMainFile(files) ?? files[0];
        const content = documents.get(mainFile)?.content ?? "";
        const frontmatter = knowledgeDashboardKitParseFrontmatter(content);
        const title = frontmatter.title ?? slug.replace(/^\d{4}-\d{2}-\d{2}(-\d{6})?-/, "").replace(/-/g, " ");
        if (title.includes("{{"))
            continue;
        entries.push(publishEntry(context, {
            type: collection.type, slug, title,
            date: knowledgeDashboardKitResolveCollectionDate({ frontmatter, slug }),
            status: frontmatter.status ?? "unknown", fileCount: files.length, mainFile, files, dirPath,
            githubUrl: knowledgeDashboardKitGithubTreeUrl({ config: context.config, repoRelativePath: dirPath }),
            crossRefs: knowledgeDashboardKitExtractCrossRefs(content),
            searchText: knowledgeDashboardKitExtractSearchText({ content }),
        }, documents));
    }
    return entries;
}
/**
 * Scans flat documents and immediate docs bundles without granting collection-root exceptions.
 * @param context - Shared scan state and budgets.
 * @param source - Configured docs source and display label.
 * @returns Nonempty flat or bundled documentation entries.
 * @throws When an aggregate scan budget is exceeded.
 */
function scanDocsSource(context, source) {
    const relative = source.dir === "." ? "" : source.dir;
    const hiddenRoots = new Set();
    const items = directoryItems(context, relative, hiddenRoots);
    const entries = [];
    for (const item of items) {
        const filePath = [relative, item.name].filter(Boolean).join("/");
        if (!item.isFile())
            continue;
        const document = scanDocument(context, filePath, hiddenRoots);
        if (document === null)
            continue;
        const frontmatter = knowledgeDashboardKitParseFrontmatter(document.content);
        const baseName = item.name.replace(/\.[^.]+$/, "");
        entries.push(publishEntry(context, {
            type: "docs", slug: `${source.repoLabel}/${filePath}`, title: frontmatter.title ?? baseName.replace(/_/g, " "),
            date: frontmatter.date ?? document.stat.mtime.toISOString().slice(0, 10), status: source.repoLabel,
            fileCount: 1, mainFile: item.name, files: [item.name], dirPath: relative,
            githubUrl: knowledgeDashboardKitGithubTreeUrl({ config: context.config, repoRelativePath: relative }),
            crossRefs: [], repo: source.repoLabel, searchText: knowledgeDashboardKitExtractSearchText({ content: document.content }),
        }, new Map([[item.name, document]])));
    }
    for (const item of items) {
        if (!item.isDirectory() || item.name.startsWith("."))
            continue;
        const dirPath = [relative, item.name].filter(Boolean).join("/");
        const documents = bundleDocuments(context, dirPath, hiddenRoots);
        const files = [...documents.keys()];
        if (files.length === 0)
            continue;
        const mainFile = files.find((file) => file === "README.md") ?? files.find((file) => file.endsWith(".md")) ?? files[0];
        const content = documents.get(mainFile)?.content ?? "";
        const frontmatter = knowledgeDashboardKitParseFrontmatter(content);
        const latestMtime = [...documents.values()].reduce((latest, document) => Math.max(latest, document.stat.mtimeMs), 0);
        entries.push(publishEntry(context, {
            type: "docs", slug: `${source.repoLabel}/${dirPath}/`, title: frontmatter.title ?? item.name,
            date: frontmatter.date ?? new Date(latestMtime).toISOString().slice(0, 10), status: source.repoLabel,
            fileCount: files.length, mainFile, files, dirPath,
            githubUrl: knowledgeDashboardKitGithubTreeUrl({ config: context.config, repoRelativePath: dirPath }),
            crossRefs: [], repo: source.repoLabel, searchText: knowledgeDashboardKitExtractSearchText({ content }),
        }, documents));
    }
    return entries;
}
/**
 * Walks a single dated collection with its own bounded scan.
 * @param options - Collection, trusted configuration, root, and optional logger.
 * @returns Safe nonempty entries, or an empty list if the scan budget is exceeded.
 * @throws If hidden-root or budget configuration is invalid.
 */
export function knowledgeDashboardKitScanCollection(options) {
    return [...knowledgeDashboardKitScanAll({ ...options, config: { ...options.config, collections: [options.collection], docsSources: [] } }).entries];
}
/**
 * Walks a single docs source with its own bounded scan.
 * @param options - Source, trusted configuration, root, and optional logger.
 * @returns Safe nonempty entries, or an empty list if the scan budget is exceeded.
 * @throws If hidden-root or budget configuration is invalid.
 */
export function knowledgeDashboardKitScanDocsSource(options) {
    return [...knowledgeDashboardKitScanAll({ ...options, config: { ...options.config, collections: [], docsSources: [options.source] } }).entries];
}
/**
 * Refreshes the full bounded index and private scan-time filesystem identities.
 * @param options - Trusted configuration, root, and optional logger.
 * @returns Safe entries and counts, or an empty index with a path-free budget error.
 * @throws If hidden-root or budget configuration is invalid, before scanning begins.
 */
export function knowledgeDashboardKitScanAll(options) {
    const context = createScanContext(options);
    const entries = [];
    const counts = { docs: 0, plans: 0, specs: 0, studies: 0 };
    try {
        for (const collection of context.config.collections)
            entries.push(...scanCollection(context, collection));
        for (const source of context.config.docsSources)
            entries.push(...scanDocsSource(context, source));
        for (const entry of entries)
            counts[entry.type]++;
        const result = { entries, counts, scannedAt: new Date().toISOString() };
        knowledgeDashboardKitScanIdentities.set(result, context.documents);
        return result;
    }
    catch (error) {
        if (!(error instanceof ScanBudgetExceeded))
            throw error;
        return { entries: [], counts, scannedAt: new Date().toISOString(), error: "Scan budget exceeded" };
    }
}
//# sourceMappingURL=scan.js.map