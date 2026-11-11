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
import path from "node:path";
import {
  knowledgeDashboardKitReadDocument,
  knowledgeDashboardKitResolveSafePath,
} from "./content-policy.js";
import type {
  KnowledgeDashboardKit_CollectionConfig,
  KnowledgeDashboardKit_CollectionType,
  KnowledgeDashboardKit_Config,
  KnowledgeDashboardKit_DocsSourceConfig,
  KnowledgeDashboardKit_Entry,
  KnowledgeDashboardKit_ScanResult,
} from "./types.js";

/** Minimal logger surface used by scanner helpers. */
export type KnowledgeDashboardKit_ScanLogger = {
  readonly error: (line: string, error?: unknown) => void;
};

const DEFAULT_SCAN_LOGGER: KnowledgeDashboardKit_ScanLogger = {
  error: (line, error): void => {
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
export function knowledgeDashboardKitParseFrontmatter(
  content: string,
): Record<string, string> {
  const result: Record<string, string> = {};
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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
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
export function knowledgeDashboardKitExtractSearchText(options: {
  readonly content: string;
  readonly maxLength?: number;
}): string {
  return options.content
    .replace(/^---\n[\s\S]*?\n---\n?/, "")
    .slice(0, options.maxLength ?? 300)
    .replace(/\n+/g, " ")
    .trim();
}

/** Builds a GitHub tree URL for a configured repo/branch and repo-relative path. */
function knowledgeDashboardKitGithubTreeUrl(options: {
  readonly config: KnowledgeDashboardKit_Config;
  readonly repoRelativePath: string;
}): string {
  return `https://github.com/${options.config.githubRepo}/tree/${options.config.githubBranch}/${options.repoRelativePath}`;
}

/** Finds the main markdown file for a dated collection entry. */
function knowledgeDashboardKitFindCollectionMainFile(
  files: readonly string[],
): string | null {
  return (
    files.find(
      (file) =>
        file.startsWith("study-") ||
        file.startsWith("plan-") ||
        file.startsWith("spec-"),
    ) ??
    files.find((file) => file.endsWith(".md") && !file.startsWith("appendix-")) ??
    null
  );
}

/** Extracts collection date from frontmatter or slug. */
function knowledgeDashboardKitResolveCollectionDate(options: {
  readonly frontmatter: Record<string, string>;
  readonly slug: string;
}): string {
  const dateMatch = options.slug.match(/^(\d{4}-\d{2}-\d{2})/);
  return (
    options.frontmatter.created_at ??
    options.frontmatter.date ??
    (dateMatch === null ? "unknown" : dateMatch[1] ?? "unknown")
  );
}

/** Extracts markdown cross-reference paths to dated collections. */
function knowledgeDashboardKitExtractCrossRefs(content: string): string[] {
  const refMatches = content.match(/\.(studies|specs|plans)\/[^\s)>\]"']+/g);
  return refMatches === null ? [] : [...new Set(refMatches)];
}

/**
 * Walks one dated-folder collection under the project root.
 *
 * @param options - Trusted collection configuration, root, and optional logging hook.
 * @returns Entries containing only readable documents allowed by the mandatory policy.
 */
export function knowledgeDashboardKitScanCollection(options: {
  readonly collection: KnowledgeDashboardKit_CollectionConfig;
  readonly config: KnowledgeDashboardKit_Config;
  readonly logger?: KnowledgeDashboardKit_ScanLogger;
  readonly projectRoot: string;
}): KnowledgeDashboardKit_Entry[] {
  const logger = options.logger ?? DEFAULT_SCAN_LOGGER;
  const collectionPath = options.collection.dir === "." ? "" : options.collection.dir;
  const resolvedCollection = knowledgeDashboardKitResolveSafePath(options.projectRoot, collectionPath, "directory");
  if (resolvedCollection === null) {
    return [];
  }

  const collectionDir = resolvedCollection.realPath;
  const entries: KnowledgeDashboardKit_Entry[] = [];
  let collectionItems: fs.Dirent[];
  try {
    collectionItems = fs.readdirSync(collectionDir, { withFileTypes: true });
  } catch {
    logger.error("Failed to read collection directory.");
    return [];
  }
  const subdirs = collectionItems
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort()
    .reverse();

  for (const slug of subdirs) {
    if (slug.startsWith("_")) {
      continue;
    }

    const entryRelative = [collectionPath, slug].filter(Boolean).join("/");
    const resolvedEntry = knowledgeDashboardKitResolveSafePath(options.projectRoot, entryRelative, "directory");
    if (resolvedEntry === null) continue;
    const entryDir = resolvedEntry.realPath;
    let allFiles: string[];
    try {
      allFiles = fs
        .readdirSync(entryDir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((file) => knowledgeDashboardKitReadDocument(options.projectRoot, `${entryRelative}/${file}`) !== null);
    } catch {
      logger.error("Failed to read entry directory.");
      continue;
    }

    if (allFiles.length === 0) continue;
    const mainFile = knowledgeDashboardKitFindCollectionMainFile(allFiles);
    let frontmatter: Record<string, string> = {};
    let mainContent = "";
    if (mainFile !== null) {
      try {
        mainContent = knowledgeDashboardKitReadDocument(options.projectRoot, `${entryRelative}/${mainFile}`)?.content ?? "";
        frontmatter = knowledgeDashboardKitParseFrontmatter(mainContent);
      } catch {
        logger.error("Failed to read main document.");
      }
    }

    const title =
      frontmatter.title ??
      slug.replace(/^\d{4}-\d{2}-\d{2}(-\d{6})?-/, "").replace(/-/g, " ");
    if (title.includes("{{")) {
      continue;
    }

    entries.push({
      type: options.collection.type,
      slug,
      title,
      date: knowledgeDashboardKitResolveCollectionDate({ frontmatter, slug }),
      status: frontmatter.status ?? "unknown",
      fileCount: allFiles.length,
      mainFile,
      files: allFiles,
      dirPath: entryRelative,
      githubUrl: knowledgeDashboardKitGithubTreeUrl({
        config: options.config,
        repoRelativePath: entryRelative,
      }),
      crossRefs: knowledgeDashboardKitExtractCrossRefs(mainContent),
      searchText: knowledgeDashboardKitExtractSearchText({ content: mainContent }),
    });
  }

  return entries;
}

/** Collects one entry per top-level allowed document under a docs source. */
function knowledgeDashboardKitCollectDocsFlatMarkdownEntries(options: {
  readonly config: KnowledgeDashboardKit_Config;
  readonly projectRoot: string;
  readonly items: readonly fs.Dirent[];
  readonly source: KnowledgeDashboardKit_DocsSourceConfig;
}): KnowledgeDashboardKit_Entry[] {
  const entries: KnowledgeDashboardKit_Entry[] = [];

  for (const item of options.items) {
    if (!item.isFile()) {
      continue;
    }

    const relative = [options.source.dir, item.name].filter(Boolean).join("/");
    const document = knowledgeDashboardKitReadDocument(options.projectRoot, relative);
    if (document === null) continue;
    const { content: fileContent, stat } = document;
    const frontmatter = knowledgeDashboardKitParseFrontmatter(fileContent);

    const baseName = item.name.replace(/\.[^.]+$/, "");
    entries.push({
      type: "docs",
      slug: `${options.source.repoLabel}/${baseName}`,
      title: frontmatter.title ?? baseName.replace(/_/g, " "),
      date: frontmatter.date ?? stat.mtime.toISOString().slice(0, 10),
      status: options.source.repoLabel,
      fileCount: 1,
      mainFile: item.name,
      files: [item.name],
      dirPath: options.source.dir,
      githubUrl: knowledgeDashboardKitGithubTreeUrl({
        config: options.config,
        repoRelativePath: options.source.dir,
      }),
      crossRefs: [],
      repo: options.source.repoLabel,
      searchText: knowledgeDashboardKitExtractSearchText({ content: fileContent }),
    });
  }

  return entries;
}

/** Returns the latest mtime-backed ISO date for a docs subfolder. */
function knowledgeDashboardKitResolveSubfolderDate(options: {
  readonly files: readonly string[];
  readonly logger: KnowledgeDashboardKit_ScanLogger;
  readonly subDir: string;
}): string {
  let latestMtime = 0;
  for (const file of options.files) {
    const filePath = path.join(options.subDir, file);
    try {
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs > latestMtime) {
        latestMtime = stat.mtimeMs;
      }
    } catch {
      options.logger.error("Failed to inspect document.");
    }
  }
  return latestMtime > 0
    ? new Date(latestMtime).toISOString().slice(0, 10)
    : "unknown";
}

/** Collects one bundled entry per immediate subdirectory of a docs source. */
function knowledgeDashboardKitCollectDocsSubfolderBundleEntries(options: {
  readonly config: KnowledgeDashboardKit_Config;
  readonly projectRoot: string;
  readonly items: readonly fs.Dirent[];
  readonly logger: KnowledgeDashboardKit_ScanLogger;
  readonly source: KnowledgeDashboardKit_DocsSourceConfig;
}): KnowledgeDashboardKit_Entry[] {
  const entries: KnowledgeDashboardKit_Entry[] = [];

  for (const item of options.items) {
    if (!item.isDirectory() || item.name.startsWith(".")) {
      continue;
    }

    const repoRelativePath = [options.source.dir, item.name].filter(Boolean).join("/");
    const resolvedSubdir = knowledgeDashboardKitResolveSafePath(options.projectRoot, repoRelativePath, "directory");
    if (resolvedSubdir === null) continue;
    const subDir = resolvedSubdir.realPath;
    let subFiles: string[];
    try {
      subFiles = fs
        .readdirSync(subDir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((file) => knowledgeDashboardKitReadDocument(options.projectRoot, `${repoRelativePath}/${file}`) !== null);
    } catch {
      options.logger.error("Failed to read document directory.");
      continue;
    }
    if (subFiles.length === 0) {
      continue;
    }

    const mainFile =
      subFiles.find((file) => file === "README.md") ??
      subFiles.find((file) => file.endsWith(".md")) ??
      null;
    let mainContent = "";
    let frontmatter: Record<string, string> = {};
    if (mainFile !== null) {
      try {
        mainContent = knowledgeDashboardKitReadDocument(options.projectRoot, `${repoRelativePath}/${mainFile}`)?.content ?? "";
        frontmatter = knowledgeDashboardKitParseFrontmatter(mainContent);
      } catch {
        options.logger.error("Failed to read main document.");
      }
    }

    entries.push({
      type: "docs",
      slug: `${options.source.repoLabel}/${item.name}`,
      title: frontmatter.title ?? item.name,
      date:
        frontmatter.date ??
        knowledgeDashboardKitResolveSubfolderDate({
          files: subFiles,
          logger: options.logger,
          subDir,
        }),
      status: options.source.repoLabel,
      fileCount: subFiles.length,
      mainFile,
      files: subFiles,
      dirPath: repoRelativePath,
      githubUrl: knowledgeDashboardKitGithubTreeUrl({
        config: options.config,
        repoRelativePath,
      }),
      crossRefs: [],
      repo: options.source.repoLabel,
      searchText: knowledgeDashboardKitExtractSearchText({ content: mainContent }),
    });
  }

  return entries;
}

/**
 * Indexes markdown under a single docs source.
 *
 * @param options - Trusted source configuration, root, and optional logging hook.
 * @returns Flat document entries and immediate subfolder bundles allowed by the policy.
 */
export function knowledgeDashboardKitScanDocsSource(options: {
  readonly config: KnowledgeDashboardKit_Config;
  readonly logger?: KnowledgeDashboardKit_ScanLogger;
  readonly projectRoot: string;
  readonly source: KnowledgeDashboardKit_DocsSourceConfig;
}): KnowledgeDashboardKit_Entry[] {
  const logger = options.logger ?? DEFAULT_SCAN_LOGGER;
  const source = { ...options.source, dir: options.source.dir === "." ? "" : options.source.dir };
  const resolvedDocs = knowledgeDashboardKitResolveSafePath(options.projectRoot, source.dir, "directory");
  if (resolvedDocs === null) {
    return [];
  }

  const docsDir = resolvedDocs.realPath;
  let items: fs.Dirent[];
  try {
    items = fs.readdirSync(docsDir, { withFileTypes: true });
  } catch {
    logger.error("Failed to read docs directory.");
    return [];
  }

  return [
    ...knowledgeDashboardKitCollectDocsFlatMarkdownEntries({
      config: options.config,
      items,
      source,
      projectRoot: options.projectRoot,
    }),
    ...knowledgeDashboardKitCollectDocsSubfolderBundleEntries({
      config: options.config,
      items,
      logger,
      source,
      projectRoot: options.projectRoot,
    }),
  ];
}

/** Creates a zeroed counts record without type assertions. */
function knowledgeDashboardKitCreateEmptyCounts(): Record<KnowledgeDashboardKit_CollectionType, number> {
  return { docs: 0, plans: 0, specs: 0, studies: 0 };
}

/**
 * Refreshes the full in-memory index for all configured collections and docs sources.
 *
 * @param options - Trusted dashboard configuration, root, and optional logging hook.
 * @returns The current safe document index, timestamp, and counts by entry type.
 */
export function knowledgeDashboardKitScanAll(options: {
  readonly config: KnowledgeDashboardKit_Config;
  readonly logger?: KnowledgeDashboardKit_ScanLogger;
  readonly projectRoot: string;
}): KnowledgeDashboardKit_ScanResult {
  const logger = options.logger ?? DEFAULT_SCAN_LOGGER;
  const entries: KnowledgeDashboardKit_Entry[] = [];
  const counts = knowledgeDashboardKitCreateEmptyCounts();

  for (const collection of options.config.collections) {
    const collectionEntries = knowledgeDashboardKitScanCollection({
      collection,
      config: options.config,
      logger,
      projectRoot: options.projectRoot,
    });
    entries.push(...collectionEntries);
    counts[collection.type] = collectionEntries.length;
  }

  let docsCount = 0;
  for (const source of options.config.docsSources) {
    const docsEntries = knowledgeDashboardKitScanDocsSource({
      config: options.config,
      logger,
      projectRoot: options.projectRoot,
      source,
    });
    entries.push(...docsEntries);
    docsCount += docsEntries.length;
  }
  counts.docs = docsCount;

  return { entries, scannedAt: new Date().toISOString(), counts };
}
