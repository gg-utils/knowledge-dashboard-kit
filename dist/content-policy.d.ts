/** Shared, non-configurable filesystem rules for indexed and served documents. */
import fs from "node:fs";
/** Maximum UTF-8 document size, enforced before and during every read (1 MiB). */
export declare const KNOWLEDGE_DASHBOARD_MAX_DOCUMENT_BYTES: number;
/**
 * Checks a canonical root-relative path without decoding or normalizing unsafe input.
 *
 * @param relative - Root-relative POSIX path; an empty string denotes the root.
 * @returns Whether every segment satisfies the mandatory deny policy.
 */
export declare function knowledgeDashboardKitIsSafeRelativePath(relative: string): boolean;
/**
 * Allows only text documentation formats consumed by the dashboard's text viewer.
 *
 * @param relative - Canonical root-relative filename.
 * @returns Whether the path is safe and has one of the four supported extensions.
 */
export declare function knowledgeDashboardKitIsDocumentPath(relative: string): boolean;
/**
 * Resolves a regular file or directory inside the real root, refusing every symlink.
 *
 * @param projectRoot - Trusted configured root, resolved to its real path.
 * @param relative - Canonical root-relative path to validate.
 * @param kind - Required filesystem object type.
 * @returns A contained real path and metadata, or null for denied or inaccessible objects.
 */
export declare function knowledgeDashboardKitResolveSafePath(projectRoot: string, relative: string, kind: "file" | "directory"): {
    readonly realPath: string;
    readonly stat: fs.Stats;
} | null;
/**
 * Reads a bounded regular document and rechecks identity to fail closed on replacement.
 *
 * @param projectRoot - Trusted root containing publishable documentation.
 * @param relative - Canonical root-relative document filename.
 * @returns UTF-8 text and metadata, or null on denial, replacement, or read failure.
 */
export declare function knowledgeDashboardKitReadDocument(projectRoot: string, relative: string): {
    readonly content: string;
    readonly stat: fs.Stats;
} | null;
//# sourceMappingURL=content-policy.d.ts.map