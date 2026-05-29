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

/** Parses the first `---` fence in markdown into simple string key/value pairs. */
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

/** Builds a compact plain-text preview for client-side search after dropping frontmatter. */
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

/** Walks one dated-folder collection under the project root. */
export function knowledgeDashboardKitScanCollection(options: {
  readonly collection: KnowledgeDashboardKit_CollectionConfig;
  readonly config: KnowledgeDashboardKit_Config;
  readonly logger?: KnowledgeDashboardKit_ScanLogger;
  readonly projectRoot: string;
}): KnowledgeDashboardKit_Entry[] {
  const logger = options.logger ?? DEFAULT_SCAN_LOGGER;
  const collectionDir = path.join(options.projectRoot, options.collection.dir);
  if (!fs.existsSync(collectionDir)) {
    return [];
  }

  const entries: KnowledgeDashboardKit_Entry[] = [];
  const subdirs = fs
    .readdirSync(collectionDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort()
    .reverse();

  for (const slug of subdirs) {
    if (slug.startsWith("_")) {
      continue;
    }

    const entryDir = path.join(collectionDir, slug);
    let allFiles: string[];
    try {
      allFiles = fs
        .readdirSync(entryDir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name);
    } catch (error: unknown) {
      logger.error(`Failed to read entry directory ${entryDir}:`, error);
      continue;
    }

    const mainFile = knowledgeDashboardKitFindCollectionMainFile(allFiles);
    let frontmatter: Record<string, string> = {};
    let mainContent = "";
    if (mainFile !== null) {
      try {
        mainContent = fs.readFileSync(path.join(entryDir, mainFile), "utf8");
        frontmatter = knowledgeDashboardKitParseFrontmatter(mainContent);
      } catch (error: unknown) {
        logger.error(`Failed to read main file ${mainFile} in ${entryDir}:`, error);
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
      dirPath: `${options.collection.dir}/${slug}`,
      githubUrl: knowledgeDashboardKitGithubTreeUrl({
        config: options.config,
        repoRelativePath: `${options.collection.dir}/${slug}`,
      }),
      crossRefs: knowledgeDashboardKitExtractCrossRefs(mainContent),
      searchText: knowledgeDashboardKitExtractSearchText({ content: mainContent }),
    });
  }

  return entries;
}

/** Collects one entry per top-level `.md` file under a docs source. */
function knowledgeDashboardKitCollectDocsFlatMarkdownEntries(options: {
  readonly config: KnowledgeDashboardKit_Config;
  readonly docsDir: string;
  readonly items: readonly fs.Dirent[];
  readonly logger: KnowledgeDashboardKit_ScanLogger;
  readonly source: KnowledgeDashboardKit_DocsSourceConfig;
}): KnowledgeDashboardKit_Entry[] {
  const entries: KnowledgeDashboardKit_Entry[] = [];

  for (const item of options.items) {
    if (!item.isFile() || !item.name.endsWith(".md")) {
      continue;
    }

    const filePath = path.join(options.docsDir, item.name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch (error: unknown) {
      options.logger.error(`Failed to stat file ${filePath}:`, error);
      continue;
    }

    let fileContent = "";
    let frontmatter: Record<string, string> = {};
    try {
      fileContent = fs.readFileSync(filePath, "utf8");
      frontmatter = knowledgeDashboardKitParseFrontmatter(fileContent);
    } catch (error: unknown) {
      options.logger.error(`Failed to read file ${filePath}:`, error);
    }

    const baseName = item.name.replace(/\.md$/, "");
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
    } catch (error: unknown) {
      options.logger.error(`Failed to stat file ${filePath}:`, error);
    }
  }
  return latestMtime > 0
    ? new Date(latestMtime).toISOString().slice(0, 10)
    : "unknown";
}

/** Collects one bundled entry per immediate subdirectory of a docs source. */
function knowledgeDashboardKitCollectDocsSubfolderBundleEntries(options: {
  readonly config: KnowledgeDashboardKit_Config;
  readonly docsDir: string;
  readonly items: readonly fs.Dirent[];
  readonly logger: KnowledgeDashboardKit_ScanLogger;
  readonly source: KnowledgeDashboardKit_DocsSourceConfig;
}): KnowledgeDashboardKit_Entry[] {
  const entries: KnowledgeDashboardKit_Entry[] = [];

  for (const item of options.items) {
    if (!item.isDirectory() || item.name.startsWith(".")) {
      continue;
    }

    const subDir = path.join(options.docsDir, item.name);
    let subFiles: string[];
    try {
      subFiles = fs
        .readdirSync(subDir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name);
    } catch (error: unknown) {
      options.logger.error(`Failed to read subdirectory ${subDir}:`, error);
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
        mainContent = fs.readFileSync(path.join(subDir, mainFile), "utf8");
        frontmatter = knowledgeDashboardKitParseFrontmatter(mainContent);
      } catch (error: unknown) {
        options.logger.error(`Failed to read main file ${mainFile} in ${subDir}:`, error);
      }
    }

    const repoRelativePath = `${options.source.dir}/${item.name}`;
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

/** Indexes markdown under a single docs source. */
export function knowledgeDashboardKitScanDocsSource(options: {
  readonly config: KnowledgeDashboardKit_Config;
  readonly logger?: KnowledgeDashboardKit_ScanLogger;
  readonly projectRoot: string;
  readonly source: KnowledgeDashboardKit_DocsSourceConfig;
}): KnowledgeDashboardKit_Entry[] {
  const logger = options.logger ?? DEFAULT_SCAN_LOGGER;
  const docsDir = path.join(options.projectRoot, options.source.dir);
  if (!fs.existsSync(docsDir)) {
    return [];
  }

  let items: fs.Dirent[];
  try {
    items = fs.readdirSync(docsDir, { withFileTypes: true });
  } catch (error: unknown) {
    logger.error(`Failed to read docs directory ${docsDir}:`, error);
    return [];
  }

  return [
    ...knowledgeDashboardKitCollectDocsFlatMarkdownEntries({
      config: options.config,
      docsDir,
      items,
      logger,
      source: options.source,
    }),
    ...knowledgeDashboardKitCollectDocsSubfolderBundleEntries({
      config: options.config,
      docsDir,
      items,
      logger,
      source: options.source,
    }),
  ];
}

/** Creates a zeroed counts record without type assertions. */
function knowledgeDashboardKitCreateEmptyCounts(): Record<KnowledgeDashboardKit_CollectionType, number> {
  return { docs: 0, plans: 0, specs: 0, studies: 0 };
}

/** Refreshes the full in-memory index for all configured collections and docs sources. */
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
