/** Shared mandatory filesystem rules for indexed and served documents. */
import fs from "node:fs";
import path from "node:path";
/** Maximum UTF-8 document size, enforced before and during every read (1 MiB). */
export const KNOWLEDGE_DASHBOARD_MAX_DOCUMENT_BYTES = 1024 * 1024;
/** Private scan metadata; identities and collection permissions never enter an API response. */
export const knowledgeDashboardKitScanIdentities = new WeakMap();
/**
 * Validates explicit hidden collection names before scanning or starting a listener.
 * @param config - Trusted configuration containing the requested exception list.
 * @returns Canonical names explicitly configured as direct collection roots.
 * @throws If a name is noncanonical or belongs to the fixed reserved families.
 */
export function knowledgeDashboardKitHiddenRoots(config) {
    const names = config.allowedHiddenCollectionRoots ?? [];
    for (const name of names) {
        if (!/^\.[a-z][a-z0-9_-]*$/u.test(name) ||
            /^\.(?:env|git)/iu.test(name) ||
            /^\.(?:ssh|aws|gnupg|npmrc|npm|docker|kube|config|netrc|pypirc|azure|gcloud|cache|local|vscode|idea)$/iu.test(name)) {
            throw new Error("Invalid hidden collection root.");
        }
    }
    return new Set(names.filter((name) => config.collections.some((collection) => collection.dir === name)));
}
/**
 * Checks a canonical relative path, granting an exception only to its first root segment.
 * @param relative - POSIX relative path; an empty string denotes the root.
 * @param hiddenRoots - Validated exact collection-root exceptions.
 * @returns Whether all segments satisfy the deny policy before extension filtering.
 */
export function knowledgeDashboardKitIsSafeRelativePath(relative, hiddenRoots = new Set()) {
    if (/[\\%:\u0000-\u001f\u007f]/u.test(relative) || path.isAbsolute(relative))
        return false;
    return relative === "" || relative.split("/").every((segment, index) => segment.length > 0 && (!segment.startsWith(".") || (index === 0 && hiddenRoots.has(segment))) &&
        !/^(?:node_modules$|id_rsa|id_ed25519|credentials|secrets)/iu.test(segment) &&
        !/(?:^|\.)(?:env|pem|key|p12|pfx|sqlite|db)(?:\.|$)/iu.test(segment));
}
/**
 * Allows only documentation formats after applying every name and path deny.
 * @param relative - Canonical root-relative filename.
 * @param hiddenRoots - Validated exact collection-root exceptions.
 * @returns Whether the path is safe and has a supported extension.
 */
export function knowledgeDashboardKitIsDocumentPath(relative, hiddenRoots = new Set()) {
    return relative !== "" && knowledgeDashboardKitIsSafeRelativePath(relative, hiddenRoots) &&
        /\.(?:md|mdx|txt|html)$/iu.test(relative);
}
/**
 * Compares complete identity chains without treating an empty chain as a match.
 * @param actual - Identity chain observed now.
 * @param expected - Identity chain recorded by the scan or before opening.
 * @returns Whether every device and inode matches in the same position.
 */
function sameIdentity(actual, expected) {
    return actual.length > 0 && actual.length === expected.length && actual.every((item, index) => item.dev === expected[index].dev && item.ino === expected[index].ino);
}
/**
 * Resolves an exact-spelled regular object inside the real root, refusing all symlinks.
 * @param projectRoot - Trusted configured root, resolved to its real path.
 * @param relative - Canonical relative path to validate.
 * @param kind - Required filesystem object type.
 * @param hiddenRoots - Validated exact collection-root exceptions.
 * @returns Contained path, metadata, and ancestor identities; null on denial.
 */
export function knowledgeDashboardKitResolveSafePath(projectRoot, relative, kind, hiddenRoots = new Set()) {
    if (!knowledgeDashboardKitIsSafeRelativePath(relative, hiddenRoots))
        return null;
    try {
        const realRoot = fs.realpathSync(projectRoot);
        let candidate = realRoot;
        const identity = [fs.statSync(realRoot)].map(({ dev, ino }) => ({ dev, ino }));
        for (const segment of relative === "" ? [] : relative.split("/")) {
            // Directory entries prevent case-insensitive and Unicode filesystem aliases.
            if (!fs.readdirSync(candidate).includes(segment))
                return null;
            candidate = path.join(candidate, segment);
            const stat = fs.lstatSync(candidate);
            if (stat.isSymbolicLink())
                return null;
            identity.push({ dev: stat.dev, ino: stat.ino });
        }
        const realPath = fs.realpathSync(candidate);
        const realRelative = path.relative(realRoot, realPath).split(path.sep).join("/");
        if (realRelative !== relative || !knowledgeDashboardKitIsSafeRelativePath(realRelative, hiddenRoots))
            return null;
        const stat = fs.statSync(realPath);
        if (kind === "directory" ? !stat.isDirectory() : !stat.isFile())
            return null;
        if (kind === "file" && (stat.nlink !== 1 || stat.size > KNOWLEDGE_DASHBOARD_MAX_DOCUMENT_BYTES))
            return null;
        return { realPath, stat, identity };
    }
    catch {
        return null;
    }
}
/**
 * Reads a bounded regular document, checking scan identity and all ancestors before and after.
 * @param projectRoot - Trusted root containing publishable documents.
 * @param relative - Exact canonical root-relative filename.
 * @param options - Validated root exceptions, scan identity, and optional scan-budget reservation.
 * @returns UTF-8 text, stat, and identities, or null for denied or changed objects.
 * @throws If the caller's budget reservation rejects the upcoming read.
 */
export function knowledgeDashboardKitReadDocument(projectRoot, relative, options = {}) {
    const hiddenRoots = options.hiddenRoots ?? new Set();
    if (!knowledgeDashboardKitIsDocumentPath(relative, hiddenRoots))
        return null;
    const resolved = knowledgeDashboardKitResolveSafePath(projectRoot, relative, "file", hiddenRoots);
    if (resolved === null || (options.expectedIdentity !== undefined && !sameIdentity(resolved.identity, options.expectedIdentity)))
        return null;
    options.beforeRead?.(resolved.stat.size);
    let descriptor;
    try {
        descriptor = fs.openSync(resolved.realPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
        const stat = fs.fstatSync(descriptor);
        if (!stat.isFile() || stat.nlink !== 1 || stat.size !== resolved.stat.size ||
            stat.dev !== resolved.stat.dev || stat.ino !== resolved.stat.ino)
            return null;
        // Read at most the reserved size. Growth is rejected by the final descriptor check.
        const buffer = Buffer.alloc(stat.size);
        let length = 0;
        while (length < buffer.length) {
            const count = fs.readSync(descriptor, buffer, length, buffer.length - length, null);
            if (count === 0)
                break;
            length += count;
        }
        const after = fs.fstatSync(descriptor);
        const current = knowledgeDashboardKitResolveSafePath(projectRoot, relative, "file", hiddenRoots);
        if (length !== stat.size || after.size !== stat.size || after.nlink !== 1 || current === null ||
            !sameIdentity(current.identity, resolved.identity))
            return null;
        return { content: buffer.toString("utf8"), stat, identity: resolved.identity };
    }
    catch {
        return null;
    }
    finally {
        if (descriptor !== undefined)
            fs.closeSync(descriptor);
    }
}
//# sourceMappingURL=content-policy.js.map