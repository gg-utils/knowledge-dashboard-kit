/**
 * @fileoverview HTTP server and route handlers for config-driven knowledge dashboards.
 *
 * Flow: start options -> initial scan -> `/api/status`, `/api/entries`, `/api/entry-content`, and
 * static HTML responses.
 *
 * @testing Node test runner (tsx): npm run knowledge-dashboard-kit:test
 *
 * @see packages/knowledge-dashboard-kit/src/scan.ts - Artifact scanner that builds the in-memory entry index this server caches, refreshes on `/api/entries`, and reports counts through `/api/status`.
 * @see packages/knowledge-dashboard-kit/src/types.ts - Kit config, hook, and start-server option contracts that define realm URLs, HTML paths, and logging hooks consumed by these handlers.
 * @see scripts/knowledge-base-dashboard/server.ts - Root CLI adapter that resolves project context and starts `knowledgeDashboardKitStartServer` for local knowledge-base browsing.
 * @documentation reviewed=2026-05-22 standard=FILE_OVERVIEW_STANDARDS_TYPESCRIPT@3
 */
import fs from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { knowledgeDashboardKitScanAll } from "./scan.js";
const DEFAULT_SERVER_HOOKS = {
    log: (line) => console.log(line),
    error: (line, error) => {
        if (error === undefined) {
            console.error(line);
            return;
        }
        console.error(line, error);
    },
};
/** Resolves optional hook overrides against console defaults. */
function knowledgeDashboardKitResolveServerHooks(hooks) {
    return {
        log: hooks?.log ?? DEFAULT_SERVER_HOOKS.log,
        error: hooks?.error ?? DEFAULT_SERVER_HOOKS.error,
        requestLog: hooks?.requestLog,
    };
}
/** Returns a normalized env value or the configured fallback. */
function knowledgeDashboardKitEnvValue(options) {
    return (options.env[options.key] ?? options.defaultValue).trim().toLowerCase();
}
/** Returns the first non-empty developer slug from configured env names. */
function knowledgeDashboardKitDeveloperSlug(options) {
    for (const key of options.config.realmUrl.developerSlugEnvNames) {
        const value = options.env[key];
        if (value !== undefined && value.trim().length > 0) {
            return value.trim().toLowerCase();
        }
    }
    return options.config.realmUrl.defaultDeveloperSlug.trim().toLowerCase();
}
/** Parses the router listen port from env or config fallback. */
function knowledgeDashboardKitListenPort(options) {
    const rawValue = options.env[options.config.realmUrl.listenPortEnvName] ??
        String(options.config.realmUrl.defaultListenPort);
    const parsed = Number.parseInt(rawValue, 10);
    return Number.isFinite(parsed) ? parsed : options.config.realmUrl.defaultListenPort;
}
/** Computes the HTTPS realm URL advertised on a configured local router. */
export function knowledgeDashboardKitBuildSubdomainUrl(options) {
    const realmSlug = knowledgeDashboardKitEnvValue({
        defaultValue: options.config.realmUrl.defaultRealmSlug,
        env: options.env,
        key: options.config.realmUrl.realmSlugEnvName,
    });
    const method = knowledgeDashboardKitEnvValue({
        defaultValue: options.config.realmUrl.defaultMethod,
        env: options.env,
        key: options.config.realmUrl.methodEnvName,
    });
    const rootZone = knowledgeDashboardKitEnvValue({
        defaultValue: options.config.realmUrl.defaultRootZone,
        env: options.env,
        key: options.config.realmUrl.rootZoneEnvName,
    });
    const developerSlug = knowledgeDashboardKitDeveloperSlug(options);
    const listenPort = knowledgeDashboardKitListenPort(options);
    const hostname = `${options.config.realmUrl.subdomain}.${realmSlug}.${method}.${developerSlug}.${rootZone}`;
    if (listenPort === 443) {
        return `https://${hostname}/`;
    }
    return `https://${hostname}:${String(listenPort)}/`;
}
/** Writes a JSON response. */
function knowledgeDashboardKitWriteJson(options) {
    options.res.writeHead(options.statusCode, {
        "Content-Type": "application/json",
    });
    options.res.end(JSON.stringify(options.body));
}
/** Ensures requested entry content stays under the configured project root. */
function knowledgeDashboardKitResolveEntryContentPath(options) {
    const projectRoot = path.resolve(options.projectRoot);
    const fullPath = path.resolve(projectRoot, options.entryPath, options.file);
    const relative = path.relative(projectRoot, fullPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        return null;
    }
    return fullPath;
}
/** Starts the dashboard HTTP server on `127.0.0.1`. */
export function knowledgeDashboardKitStartServer(options) {
    const hooks = knowledgeDashboardKitResolveServerHooks(options.hooks);
    const projectRoot = path.resolve(options.projectRoot);
    let cachedData = knowledgeDashboardKitScanAll({
        config: options.config,
        logger: hooks,
        projectRoot,
    });
    const server = createServer((req, res) => {
        const requestStartTime = performance.now();
        res.on("finish", () => {
            const record = {
                durationMs: performance.now() - requestStartTime,
                host: req.headers.host,
                method: req.method,
                path: req.url,
                statusCode: res.statusCode,
                statusText: res.statusMessage,
                surfaceId: options.config.realmUrl.subdomain,
            };
            hooks.requestLog?.(record);
        });
        const url = new URL(req.url ?? "/", `http://localhost:${String(options.port)}`);
        if (url.pathname === "/api/status") {
            knowledgeDashboardKitWriteJson({
                body: { status: "ok", entries: cachedData.entries.length },
                res,
                statusCode: 200,
            });
            return;
        }
        if (url.pathname === "/api/entries") {
            cachedData = knowledgeDashboardKitScanAll({
                config: options.config,
                logger: hooks,
                projectRoot,
            });
            knowledgeDashboardKitWriteJson({ body: cachedData, res, statusCode: 200 });
            return;
        }
        if (url.pathname === "/api/entry-content") {
            const entryPath = url.searchParams.get("path");
            const file = url.searchParams.get("file");
            if (entryPath === null || file === null) {
                knowledgeDashboardKitWriteJson({
                    body: { error: "Missing path or file param" },
                    res,
                    statusCode: 400,
                });
                return;
            }
            const fullPath = knowledgeDashboardKitResolveEntryContentPath({
                entryPath,
                file,
                projectRoot,
            });
            if (fullPath === null) {
                knowledgeDashboardKitWriteJson({
                    body: { error: "Forbidden" },
                    res,
                    statusCode: 403,
                });
                return;
            }
            try {
                const content = fs.readFileSync(fullPath, "utf8");
                res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
                res.end(content);
            }
            catch (error) {
                hooks.error(`Failed to read entry content ${fullPath}:`, error);
                knowledgeDashboardKitWriteJson({
                    body: { error: "File not found" },
                    res,
                    statusCode: 404,
                });
            }
            return;
        }
        try {
            const html = fs.readFileSync(options.config.htmlFilePath, "utf8");
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(html);
        }
        catch (error) {
            hooks.error(`Failed to load ${options.config.htmlFilePath}:`, error);
            res.writeHead(500, { "Content-Type": "text/plain" });
            res.end("Failed to load dashboard HTML");
        }
    });
    server.listen(options.port, "127.0.0.1", () => {
        const subdomainUrl = knowledgeDashboardKitBuildSubdomainUrl({
            config: options.config,
            env: options.env,
        });
        const directUrl = `http://127.0.0.1:${String(options.port)}/`;
        hooks.log(`\n  ${options.config.title}`);
        hooks.log("  ─────────────────────────");
        hooks.log(`  URL:      ${subdomainUrl}`);
        hooks.log(`  Direct:   ${directUrl}`);
        hooks.log(`  Studies:  ${String(cachedData.counts.studies)}`);
        hooks.log(`  Plans:    ${String(cachedData.counts.plans)}`);
        hooks.log(`  Specs:    ${String(cachedData.counts.specs)}`);
        hooks.log(`  Docs:     ${String(cachedData.counts.docs)}`);
        hooks.log(`  Total:    ${String(cachedData.entries.length)} entries\n`);
    });
    return server;
}
//# sourceMappingURL=server.js.map