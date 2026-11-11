# @gg-utils/knowledge-dashboard-kit

Config-driven scanning and HTTP server helpers for local knowledge dashboards.

Use this package when a repository has markdown studies, plans, specs, docs, or generated artifacts
that need to be indexed and served through a lightweight local dashboard.

## Install

```bash
npm install @gg-utils/knowledge-dashboard-kit@git+https://github.com/gg-utils/knowledge-dashboard-kit.git#main
```

Pin a commit for production:

```json
{
  "dependencies": {
    "@gg-utils/knowledge-dashboard-kit": "git+https://github.com/gg-utils/knowledge-dashboard-kit.git#c7f63ba"
  }
}
```

## When To Use

- You need to scan markdown collections and docs folders into searchable entries.
- You need a local HTTP server with status, entry list, and entry-content routes.
- You need dashboard bind-port resolution from CLI args, env files, process env, and defaults.
- You want the consuming repo to own collection roots, GitHub URLs, static HTML, and port env names.

## Public Surfaces

| Import | Purpose |
|---|---|
| `@gg-utils/knowledge-dashboard-kit/scan` | Markdown collection and docs-source scanner. |
| `@gg-utils/knowledge-dashboard-kit/server` | Local HTTP server and API route handlers. |
| `@gg-utils/knowledge-dashboard-kit/port-config` | Bind-port resolution helpers. |
| `@gg-utils/knowledge-dashboard-kit/types` | Config, entry, scan, and server contracts. |

## Quick Start

```ts
import {
  type KnowledgeDashboardKit_Config,
  knowledgeDashboardKitScanAll,
  knowledgeDashboardKitStartServer,
} from "@gg-utils/knowledge-dashboard-kit";

declare const config: KnowledgeDashboardKit_Config;

const scan = knowledgeDashboardKitScanAll({
  config,
  projectRoot: process.cwd(),
});

console.log(scan.entries.length);

const server = knowledgeDashboardKitStartServer({
  config,
  env: {},
  port: 4317,
  projectRoot: process.cwd(),
});

server.close();
```

## Operational Flow

```mermaid
flowchart TD
    A[Adapter supplies dashboard config] --> B[Resolve bind port]
    B --> C[Scan markdown collections and docs sources]
    C --> D[Start HTTP server]
    D --> E[/api/status]
    D --> F[/api/entries]
    D --> G[/api/entry-content]
    D --> H[Static dashboard HTML]
```

## Development

```bash
git clone https://github.com/gg-utils/knowledge-dashboard-kit.git
cd knowledge-dashboard-kit
npm run type-check
npm test
npm run build
```

Run `npm ci` first to install the package-local development toolchain.

## Layout

```text
.
|-- assets/index.html       # Default static dashboard shell
|-- src/scan.ts             # Markdown scanner
|-- src/server.ts           # HTTP server
|-- src/port-config.ts      # Port resolution
|-- src/types.ts            # Config and result contracts
|-- dist/                   # Checked-in build output
`-- package.json            # Export map and scripts
```

## Caveats

- The kit does not prescribe your content taxonomy or folder layout.
- Static assets and route labels remain adapter-owned.
- Server helpers are intentionally small and synchronous where scans read local markdown.

## Content security and compatibility changes

The content API is a documentation viewer, with a non-configurable deny policy. Both scanning and
`GET /api/entry-content?path=<entry.dirPath>&file=<entry.files item>` apply these rules:

- Only the exact directory/file pairs returned by the latest scan are eligible. Startup creates the
  first allow-list; `/api/entries` replaces it after rescanning. Newly created files remain unavailable
  until that refresh. The scanner still visits collection entries and immediate docs subfolders;
  it does not recursively publish arbitrary descendants.
- Every relative path segment beginning with `.` is denied. This includes configured `.studies`,
  `.plans`, and `.specs` roots, as well as `.env`, `.env.*`, `.git`, `.ssh`, and `.npmrc`.
  Move publishable collections to non-hidden directories such as `studies`, `plans`, and `specs`.
  Configuration cannot override this rule.
- Case-insensitive denies also cover `node_modules` segments, names beginning with `id_rsa`,
  `id_ed25519`, `credentials`, or `secrets`, and names ending in `.pem`, `.key`, `.p12`, `.pfx`,
  `.sqlite`, or `.db`.
- The complete extension allow-list is `.md`, `.mdx`, `.txt`, and `.html` (case-insensitive).
  Top-level docs files now support all four formats; collection and subfolder file lists exclude
  every other format. Images, SVG, JavaScript, JSON, archives, and extensionless files are unavailable.
  The bundled viewer consumes text and does not need a binary image endpoint.
- Paths must be canonical root-relative strings: absolute paths, dot segments, empty interior
  segments, backslashes, colons, control characters, and residual percent escapes are denied.
  Query parameters are decoded once. Use the exact `dirPath` and filename from the scan; a root
  source configured as `.` is represented by an empty `dirPath`.
- Every file and ancestor is checked against the real project root. All symlinks are refused,
  including links whose targets are inside the root. Only regular files up to **1 MiB (1,048,576
  bytes)** are indexed or served. Reads are bounded, use no-follow/non-blocking opens, and check file
  identity before and after reading. Unreadable files and empty bundles are omitted.

Missing, malformed, denied, stale, oversized, and unreadable content requests all return the same
`404 {"error":"Not found"}` response, replacing the previous mixture of 400/403/404 responses.
Generated errors and filesystem-error hooks never include absolute filesystem paths. Request logging remains
caller-controlled and receives the caller's raw request URL.

Raw documents, including HTML and MDX, are always `text/plain; charset=utf-8`, with `nosniff`,
`Cache-Control: no-store`, and a CSP that disables scripts and sandboxes direct navigation. API JSON
also declares UTF-8. The bundled shell has a CSP allowing only its inline script hashes, local API
connections, inline styles, and its data-URL favicon; inline event handlers and remote scripts are
blocked. Markdown previews escape document HTML and run inside an opaque iframe with an empty
`sandbox` attribute and a second CSP denying resource loads, scripts, forms, and base URLs. HTML,
plain-text files, and the source tab use `textContent`. External images, active links, Mermaid diagram
execution, and syntax highlighting are no longer provided; fenced code remains readable as text.
No remote rendering libraries are loaded. Custom `htmlFilePath` shells are trusted application code
and must follow these restrictions; custom inline event handlers and external assets will be blocked.

### Binding, Host, and Origin

The server continues to bind to **127.0.0.1 by default**. The exact bound loopback Host and actual
listening port are accepted, including when `port: 0` selects an ephemeral port. `localhost` is not an
implicit alias for a server bound to `127.0.0.1`. Extra Host authorities require an explicit exact
`allowedHosts` entry; there are no wildcard entries or automatic trust for the advertised router URL.
An `Origin` header, when present, must equal the HTTP origin of the accepted Host. Foreign and `null`
origins return 403 on every route; no permissive CORS headers are emitted. Only GET and HEAD are
accepted (other methods return 405 after Host/Origin validation).

```ts
const server = knowledgeDashboardKitStartServer({
  config,
  env: {},
  projectRoot: process.cwd(),
  port: 4317,
  host: "0.0.0.0", // Explicitly expose the listener beyond loopback.
  allowedHosts: ["docs.example.test:4317"], // Exact Host authority trusted by this deployment.
});
```

A non-loopback bind exposes eligible documents to clients that can reach the port and send an
allowed Host. Host and Origin checks are not authentication. Use a trusted network and an authenticating
proxy if remote access is required. HTTPS proxy origins are rejected by this HTTP server's strict
same-origin rule; configure a deployment deliberately rather than relying on forwarded headers.

The policy cannot identify secrets embedded in an otherwise allowed document or a hard-linked file.
Local users able to modify the root or its ancestors are trusted: portable Node filesystem APIs do
not provide an atomic directory-relative traversal boundary against a malicious concurrent writer.
The configured shell, configuration, and logging hooks are trusted. Scans are synchronous and there
is no aggregate scan-size limit, rate limiting, authentication, or TLS in this helper.

### Validation

Run `npm ci`, then `npm run build`, `npm run type-check`, and `npm test`. Development tools are local
`devDependencies`; the package adds no runtime dependencies. `dist/` is committed and must be rebuilt
with source changes. The declared supported engine remains Node 24 (`>=24.11.1 <25`); compatibility
checks on other installed Node versions do not expand that support promise.

Tests use synthetic temporary trees, real ephemeral HTTP listeners, raw request targets, secret
non-disclosure assertions, scanner assertions, post-scan replacements, and viewer-code tests in a
minimal DOM. They do not perform full browser-engine, hostile concurrent-writer, or cross-platform
filesystem testing.
