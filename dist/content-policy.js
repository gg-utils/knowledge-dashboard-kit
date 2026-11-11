/** Shared, non-configurable filesystem rules for indexed and served documents. */
import fs from "node:fs";
import path from "node:path";
/** Maximum UTF-8 document size, enforced before and during every read (1 MiB). */
export const KNOWLEDGE_DASHBOARD_MAX_DOCUMENT_BYTES = 1024 * 1024;
/**
 * Checks a canonical root-relative path without decoding or normalizing unsafe input.
 *
 * @param relative - Root-relative POSIX path; an empty string denotes the root.
 * @returns Whether every segment satisfies the mandatory deny policy.
 */
export function knowledgeDashboardKitIsSafeRelativePath(relative) {
    if (/[\\%:\u0000-\u001f\u007f]/u.test(relative) || path.isAbsolute(relative)) {
        return false;
    }
    return relative === "" || relative.split("/").every((segment) => segment.length > 0 && !segment.startsWith(".") &&
        !/^(?:node_modules$|id_rsa|id_ed25519|credentials|secrets)/iu.test(segment) &&
        !/\.(?:pem|key|p12|pfx|sqlite|db)$/iu.test(segment));
}
/**
 * Allows only text documentation formats consumed by the dashboard's text viewer.
 *
 * @param relative - Canonical root-relative filename.
 * @returns Whether the path is safe and has one of the four supported extensions.
 */
export function knowledgeDashboardKitIsDocumentPath(relative) {
    return relative !== "" && knowledgeDashboardKitIsSafeRelativePath(relative) &&
        /\.(?:md|mdx|txt|html)$/iu.test(relative);
}
/**
 * Resolves a regular file or directory inside the real root, refusing every symlink.
 *
 * @param projectRoot - Trusted configured root, resolved to its real path.
 * @param relative - Canonical root-relative path to validate.
 * @param kind - Required filesystem object type.
 * @returns A contained real path and metadata, or null for denied or inaccessible objects.
 */
export function knowledgeDashboardKitResolveSafePath(projectRoot, relative, kind) {
    if (!knowledgeDashboardKitIsSafeRelativePath(relative))
        return null;
    try {
        const realRoot = fs.realpathSync(projectRoot);
        let candidate = realRoot;
        for (const segment of relative === "" ? [] : relative.split("/")) {
            candidate = path.join(candidate, segment);
            if (fs.lstatSync(candidate).isSymbolicLink())
                return null;
        }
        const realPath = fs.realpathSync(candidate);
        const realRelative = path.relative(realRoot, realPath).split(path.sep).join("/");
        if (!knowledgeDashboardKitIsSafeRelativePath(realRelative))
            return null;
        const stat = fs.statSync(realPath);
        if (kind === "directory" ? !stat.isDirectory() : !stat.isFile())
            return null;
        if (kind === "file" && stat.size > KNOWLEDGE_DASHBOARD_MAX_DOCUMENT_BYTES)
            return null;
        return { realPath, stat };
    }
    catch {
        return null;
    }
}
/**
 * Reads a bounded regular document and rechecks identity to fail closed on replacement.
 *
 * @param projectRoot - Trusted root containing publishable documentation.
 * @param relative - Canonical root-relative document filename.
 * @returns UTF-8 text and metadata, or null on denial, replacement, or read failure.
 */
export function knowledgeDashboardKitReadDocument(projectRoot, relative) {
    if (!knowledgeDashboardKitIsDocumentPath(relative))
        return null;
    const resolved = knowledgeDashboardKitResolveSafePath(projectRoot, relative, "file");
    if (resolved === null)
        return null;
    let descriptor;
    try {
        descriptor = fs.openSync(resolved.realPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
        const stat = fs.fstatSync(descriptor);
        if (!stat.isFile() || stat.size > KNOWLEDGE_DASHBOARD_MAX_DOCUMENT_BYTES ||
            stat.dev !== resolved.stat.dev || stat.ino !== resolved.stat.ino)
            return null;
        const buffer = Buffer.alloc(KNOWLEDGE_DASHBOARD_MAX_DOCUMENT_BYTES + 1);
        let length = 0;
        while (length < buffer.length) {
            const count = fs.readSync(descriptor, buffer, length, buffer.length - length, null);
            if (count === 0)
                break;
            length += count;
        }
        if (length > KNOWLEDGE_DASHBOARD_MAX_DOCUMENT_BYTES)
            return null;
        const current = knowledgeDashboardKitResolveSafePath(projectRoot, relative, "file");
        if (current === null || current.stat.dev !== stat.dev || current.stat.ino !== stat.ino) {
            return null;
        }
        return { content: buffer.toString("utf8", 0, length), stat };
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