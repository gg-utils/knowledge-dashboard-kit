/** Shared mandatory filesystem rules for indexed and served documents. */
import fs from "node:fs";
import type { KnowledgeDashboardKit_Config, KnowledgeDashboardKit_ScanResult } from "./types.js";
/** Maximum UTF-8 document size, enforced before and during every read (1 MiB). */
export declare const KNOWLEDGE_DASHBOARD_MAX_DOCUMENT_BYTES: number;
/** Device/inode chain from the real root through every parent to the document. */
export type KnowledgeDashboardKit_DocumentIdentity = readonly {
    readonly dev: number;
    readonly ino: number;
}[];
/** Private document authorization records the exact policy used by its publishing collection. */
export type KnowledgeDashboardKit_PublishedDocument = {
    readonly identity: KnowledgeDashboardKit_DocumentIdentity;
    readonly hiddenRoots: ReadonlySet<string>;
};
/** Private scan metadata; identities and collection permissions never enter an API response. */
export declare const knowledgeDashboardKitScanIdentities: WeakMap<KnowledgeDashboardKit_ScanResult, ReadonlyMap<string, KnowledgeDashboardKit_PublishedDocument>>;
/**
 * Validates explicit hidden collection names before scanning or starting a listener.
 * @param config - Trusted configuration containing the requested exception list.
 * @returns Canonical names explicitly configured as direct collection roots.
 * @throws If a name is noncanonical or belongs to the fixed reserved families.
 */
export declare function knowledgeDashboardKitHiddenRoots(config: KnowledgeDashboardKit_Config): ReadonlySet<string>;
/**
 * Checks a canonical relative path, granting an exception only to its first root segment.
 * @param relative - POSIX relative path; an empty string denotes the root.
 * @param hiddenRoots - Validated exact collection-root exceptions.
 * @returns Whether all segments satisfy the deny policy before extension filtering.
 */
export declare function knowledgeDashboardKitIsSafeRelativePath(relative: string, hiddenRoots?: ReadonlySet<string>): boolean;
/**
 * Allows only documentation formats after applying every name and path deny.
 * @param relative - Canonical root-relative filename.
 * @param hiddenRoots - Validated exact collection-root exceptions.
 * @returns Whether the path is safe and has a supported extension.
 */
export declare function knowledgeDashboardKitIsDocumentPath(relative: string, hiddenRoots?: ReadonlySet<string>): boolean;
/**
 * Resolves an exact-spelled regular object inside the real root, refusing all symlinks.
 * @param projectRoot - Trusted configured root, resolved to its real path.
 * @param relative - Canonical relative path to validate.
 * @param kind - Required filesystem object type.
 * @param hiddenRoots - Validated exact collection-root exceptions.
 * @returns Contained path, metadata, and ancestor identities; null on denial.
 */
export declare function knowledgeDashboardKitResolveSafePath(projectRoot: string, relative: string, kind: "file" | "directory", hiddenRoots?: ReadonlySet<string>): {
    readonly realPath: string;
    readonly stat: fs.Stats;
    readonly identity: KnowledgeDashboardKit_DocumentIdentity;
} | null;
/**
 * Reads a bounded regular document, checking scan identity and all ancestors before and after.
 * @param projectRoot - Trusted root containing publishable documents.
 * @param relative - Exact canonical root-relative filename.
 * @param options - Validated root exceptions, scan identity, and optional scan-budget reservation.
 * @returns UTF-8 text, stat, and identities, or null for denied or changed objects.
 * @throws If the caller's budget reservation rejects the upcoming read.
 */
export declare function knowledgeDashboardKitReadDocument(projectRoot: string, relative: string, options?: {
    readonly hiddenRoots?: ReadonlySet<string>;
    readonly expectedIdentity?: KnowledgeDashboardKit_DocumentIdentity;
    readonly beforeRead?: (bytes: number) => void;
}): {
    readonly content: string;
    readonly stat: fs.Stats;
    readonly identity: KnowledgeDashboardKit_DocumentIdentity;
} | null;
//# sourceMappingURL=content-policy.d.ts.map