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
import { createServer, type IncomingMessage, type Server } from "node:http";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  knowledgeDashboardKitIsDocumentPath,
  knowledgeDashboardKitIsSafeRelativePath,
  knowledgeDashboardKitReadDocument,
  knowledgeDashboardKitScanIdentities,
} from "./content-policy.js";
import type { ServerResponse } from "node:http";
import { knowledgeDashboardKitScanAll } from "./scan.js";
import type {
  KnowledgeDashboardKit_Config,
  KnowledgeDashboardKit_RequestLogRecord,
  KnowledgeDashboardKit_ServerHooks,
  KnowledgeDashboardKit_StartServerOptions,
} from "./types.js";

const DEFAULT_SERVER_HOOKS: KnowledgeDashboardKit_ServerHooks = {
  log: (line): void => console.log(line),
  error: (line, error): void => {
    if (error === undefined) {
      console.error(line);
      return;
    }
    console.error(line, error);
  },
};

/** Resolves optional hook overrides against console defaults. */
function knowledgeDashboardKitResolveServerHooks(
  hooks: Partial<KnowledgeDashboardKit_ServerHooks> | undefined,
): KnowledgeDashboardKit_ServerHooks {
  return {
    log: hooks?.log ?? DEFAULT_SERVER_HOOKS.log,
    error: hooks?.error ?? DEFAULT_SERVER_HOOKS.error,
    ...(hooks?.requestLog === undefined ? {} : { requestLog: hooks.requestLog }),
  };
}

/** Returns a normalized env value or the configured fallback. */
function knowledgeDashboardKitEnvValue(options: {
  readonly defaultValue: string;
  readonly env: Record<string, string | undefined>;
  readonly key: string;
}): string {
  return (options.env[options.key] ?? options.defaultValue).trim().toLowerCase();
}

/** Returns the first non-empty developer slug from configured env names. */
function knowledgeDashboardKitDeveloperSlug(options: {
  readonly config: KnowledgeDashboardKit_Config;
  readonly env: Record<string, string | undefined>;
}): string {
  for (const key of options.config.realmUrl.developerSlugEnvNames) {
    const value = options.env[key];
    if (value !== undefined && value.trim().length > 0) {
      return value.trim().toLowerCase();
    }
  }
  return options.config.realmUrl.defaultDeveloperSlug.trim().toLowerCase();
}

/** Parses the router listen port from env or config fallback. */
function knowledgeDashboardKitListenPort(options: {
  readonly config: KnowledgeDashboardKit_Config;
  readonly env: Record<string, string | undefined>;
}): number {
  const rawValue =
    options.env[options.config.realmUrl.listenPortEnvName] ??
    String(options.config.realmUrl.defaultListenPort);
  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) ? parsed : options.config.realmUrl.defaultListenPort;
}

/**
 * Computes the HTTPS realm URL advertised on a configured local router.
 *
 * @param options - Realm configuration and injected environment values.
 * @returns The advertised router URL; this does not automatically trust its Host.
 */
export function knowledgeDashboardKitBuildSubdomainUrl(options: {
  readonly config: KnowledgeDashboardKit_Config;
  readonly env: Record<string, string | undefined>;
}): string {
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
function knowledgeDashboardKitWriteJson(options: {
  readonly body: unknown;
  readonly res: ServerResponse;
  readonly statusCode: number;
}): void {
  options.res.writeHead(options.statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  options.res.end(JSON.stringify(options.body));
}

/**
 * Validates an explicitly trusted Host authority without accepting URL syntax or wildcards.
 *
 * @param host - Explicitly configured Host authority.
 * @returns Whether the value is a canonical authority rather than a URL or wildcard.
 */
function knowledgeDashboardKitIsHostAuthority(host: string): boolean {
  try {
    const url = new URL(`http://${host}`);
    return host.length > 0 && !host.includes("*") && url.host === host && url.username === "" &&
      url.password === "" && url.pathname === "/" && url.search === "" && url.hash === "";
  } catch {
    return false;
  }
}

/**
 * Requires an exact trusted Host and an absent or identical HTTP Origin on every route.
 *
 * @param req - Incoming HTTP request.
 * @param server - Listening server, used to obtain the actual ephemeral port.
 * @param bindHost - Explicit or default listening hostname.
 * @param allowedHosts - Additional exact trusted authorities.
 * @returns Whether both request headers satisfy the same-origin policy.
 */
function knowledgeDashboardKitIsTrustedRequest(
  req: IncomingMessage,
  server: Server,
  bindHost: string,
  allowedHosts: ReadonlySet<string>,
): boolean {
  const headerNames = req.rawHeaders.filter((_, index) => index % 2 === 0).map((name) => name.toLowerCase());
  if (headerNames.filter((name) => name === "host").length !== 1 ||
      headerNames.filter((name) => name === "origin").length > 1) return false;
  const host = req.headers.host;
  const address = server.address();
  if (typeof host !== "string" || address === null || typeof address === "string") return false;
  const localHost = bindHost === "::1" ? "[::1]" : bindHost;
  const isLoopback = ["127.0.0.1", "::1", "localhost"].includes(bindHost);
  if (!(isLoopback && host === `${localHost}:${String(address.port)}`) && !allowedHosts.has(host)) {
    return false;
  }
  const origin = req.headers.origin;
  return origin === undefined || origin === new URL(`http://${host}`).origin;
}

/**
 * Requires viewer intent on APIs and top-level navigation metadata on the shell.
 * @param req - Request whose fetch metadata is checked without trusting a missing Origin.
 * @param isApi - Whether the route belongs to the protected API namespace.
 * @returns Whether the request is eligible after Host and Origin validation.
 */
function knowledgeDashboardKitAllowsFetch(req: IncomingMessage, isApi: boolean): boolean {
  const site = req.headers["sec-fetch-site"];
  const mode = req.headers["sec-fetch-mode"];
  const dest = req.headers["sec-fetch-dest"];
  if (isApi) {
    return req.headers["x-knowledge-dashboard"] === "1" &&
      (site === undefined || site === "same-origin" || site === "none");
  }
  if (mode !== undefined && mode !== "navigate") return false;
  if (dest !== undefined && dest !== "document") return false;
  return site === undefined || site === "same-origin" || site === "none" ||
    ((site === "cross-site" || site === "same-site") && mode === "navigate" && dest === "document");
}

/**
 * Restricts every response, with no executable content or ambient cross-origin access.
 *
 * @param res - Response receiving the restrictive default security and privacy headers.
 * @returns Nothing.
 */
function knowledgeDashboardKitSetResponseHeaders(res: ServerResponse): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
}

/**
 * Allows only the trusted shell's inline script blocks, while blocking event attributes.
 *
 * @param html - Trusted configured dashboard application shell.
 * @returns The shell CSP, with hashes of its exact inline script bytes.
 */
function knowledgeDashboardKitShellCsp(html: string): string {
  const hashes = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/giu)]
    .map((match) => `'sha256-${createHash("sha256").update(match[1] ?? "").digest("base64")}'`);
  return `default-src 'none'; script-src ${hashes.length > 0 ? hashes.join(" ") : "'none'"}; script-src-attr 'none'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
}

/**
 * Starts a loopback dashboard with scan-based content access and strict request validation.
 *
 * @param options - Trusted configuration, filesystem root, bind settings, and hooks.
 * @returns The HTTP server; callers own shutdown and server error handling.
 * @throws If an allowed Host, hidden collection name, or scan budget is invalid.
 */
export function knowledgeDashboardKitStartServer(
  options: KnowledgeDashboardKit_StartServerOptions,
): Server {
  const hooks = knowledgeDashboardKitResolveServerHooks(options.hooks);
  const projectRoot = path.resolve(options.projectRoot);
  const bindHost = options.host ?? "127.0.0.1";
  const allowedHosts = new Set(options.allowedHosts ?? []);
  if ([...allowedHosts].some((host) => !knowledgeDashboardKitIsHostAuthority(host))) {
    throw new Error("Invalid allowed Host authority.");
  }
  let cachedData = knowledgeDashboardKitScanAll({
    config: options.config,
    logger: hooks,
    projectRoot,
  });

  let allowedContent = knowledgeDashboardKitScanIdentities.get(cachedData);

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    knowledgeDashboardKitSetResponseHeaders(res);
    const requestStartTime = performance.now();
    res.on("finish", () => {
      const record: KnowledgeDashboardKit_RequestLogRecord = {
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

    if (!knowledgeDashboardKitIsTrustedRequest(req, server, bindHost, allowedHosts)) {
      knowledgeDashboardKitWriteJson({ body: { error: "Forbidden" }, res, statusCode: 403 });
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      knowledgeDashboardKitWriteJson({ body: { error: "Method not allowed" }, res, statusCode: 405 });
      return;
    }
    let url: URL;
    try {
      if (!req.url?.startsWith("/") || req.url.startsWith("//")) throw new Error("Invalid request target");
      url = new URL(req.url, "http://127.0.0.1");
    } catch {
      knowledgeDashboardKitWriteJson({ body: { error: "Not found" }, res, statusCode: 404 });
      return;
    }

    const isApi = url.pathname.startsWith("/api/");
    if (!knowledgeDashboardKitAllowsFetch(req, isApi)) {
      knowledgeDashboardKitWriteJson({ body: { error: "Forbidden" }, res, statusCode: 403 });
      return;
    }
    if (isApi && !["/api/status", "/api/entries", "/api/entry-content"].includes(url.pathname)) {
      knowledgeDashboardKitWriteJson({ body: { error: "Not found" }, res, statusCode: 404 });
      return;
    }

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
      allowedContent = knowledgeDashboardKitScanIdentities.get(cachedData);
      knowledgeDashboardKitWriteJson({ body: cachedData, res, statusCode: 200 });
      return;
    }

    if (url.pathname === "/api/entry-content") {
      const entryPath = url.searchParams.get("path");
      const file = url.searchParams.get("file");
      const relative = entryPath === "" ? file : `${entryPath}/${file}`;
      const published = allowedContent?.get(JSON.stringify([entryPath, file]));
      const hiddenRoots = published?.hiddenRoots ?? new Set<string>();
      if (entryPath === null || file === null || relative === null ||
          url.searchParams.getAll("path").length !== 1 || url.searchParams.getAll("file").length !== 1 ||
          !knowledgeDashboardKitIsSafeRelativePath(entryPath, hiddenRoots) ||
          !knowledgeDashboardKitIsDocumentPath(relative, hiddenRoots) ||
          published === undefined) {
        knowledgeDashboardKitWriteJson({ body: { error: "Not found" }, res, statusCode: 404 });
        return;
      }
      const rawPath = req.url?.split("?")[1]?.split("&").find((pair) => pair.startsWith("path="))?.slice(5) ?? "";
      const rawFile = req.url?.split("?")[1]?.split("&").find((pair) => pair.startsWith("file="))?.slice(5) ?? "";
      if (entryPath.startsWith(".") && (rawPath !== encodeURIComponent(entryPath) || rawFile !== encodeURIComponent(file))) {
        knowledgeDashboardKitWriteJson({ body: { error: "Not found" }, res, statusCode: 404 });
        return;
      }
      let changedSinceScan = false;
      const document = knowledgeDashboardKitReadDocument(projectRoot, relative, {
        hiddenRoots, expectedIdentity: published.identity, onIdentityChange: () => { changedSinceScan = true; },
      });
      if (document === null) {
        knowledgeDashboardKitWriteJson({
          body: { error: changedSinceScan ? "File changed since the last scan" : "Not found" },
          res, statusCode: changedSinceScan ? 409 : 404,
        });
        return;
      }
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(document.content);
      return;
    }

    try {
      const html = fs.readFileSync(options.config.htmlFilePath, "utf8");
      res.setHeader("Content-Security-Policy", knowledgeDashboardKitShellCsp(html));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch {
      hooks.error("Failed to load dashboard HTML.");
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Failed to load dashboard HTML");
    }
  });

  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.setTimeout(15_000, (socket) => socket.destroy());

  server.listen(options.port, bindHost, () => {
    const subdomainUrl = knowledgeDashboardKitBuildSubdomainUrl({
      config: options.config,
      env: options.env,
    });
    const address = server.address();
    const port = address !== null && typeof address !== "string" ? address.port : options.port;
    const directUrl = `http://${bindHost.includes(":") ? `[${bindHost}]` : bindHost}:${String(port)}/`;
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
