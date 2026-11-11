# @gg-utils/knowledge-dashboard-kit

Config-driven scanning and HTTP server helpers for local knowledge dashboards.

Use this package when a repository has markdown studies, plans, specs, docs, or generated artifacts
that need to be indexed and served through a lightweight local dashboard.

## Use from another repository

Requires Node `>=22.0.0 <27` (Node 22, 24 and 26 are validated). Add this exact dependency:

```json
{
  "dependencies": {
    "@gg-utils/knowledge-dashboard-kit": "git+https://github.com/gg-utils/knowledge-dashboard-kit.git#v0.2.0"
  }
}
```

From the consuming repository root, install and copy the runnable configuration and adapter:

```bash
npm install --ignore-scripts
cp node_modules/@gg-utils/knowledge-dashboard-kit/examples/knowledge-dashboard.config.mjs ./knowledge-dashboard.config.mjs
cp node_modules/@gg-utils/knowledge-dashboard-kit/examples/knowledge-dashboard.mjs ./knowledge-dashboard.mjs
node knowledge-dashboard.mjs
```

Edit `knowledge-dashboard.config.mjs` to set `githubRepo` to your `owner/repository` and the title
and branch as needed. The supplied config explicitly enables `.studies`, `.plans`, and `.specs`
collections and scans `docs` as a docs source. Collection documents belong in entry folders such as
`.studies/2026-11-11-topic/README.md`; docs may be `docs/guide.md` or `docs/topic/README.md`.
The adapter uses the current working directory as the project root and reads no env files.

Open **http://127.0.0.1:4317/**. The example's configured default port is **4317** and the server's
default bind address is **127.0.0.1**. Override the port with `node knowledge-dashboard.mjs --port 4318`
or `KNOWLEDGE_DASHBOARD_PORT`; there is no package-wide default port or CLI binary, so the copied
adapter supplies it. The bundled viewer sends the required API header. All content restrictions
below still apply, including the narrow opt-in for hidden collection roots.

Git-tag installs use the committed ESM JavaScript and declarations in `dist/`, bundled assets, and
examples, with no build step or install script. This kit has no core or other runtime dependency.

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
npm ci --ignore-scripts
npm run type-check
npm test
npm run build
npm run lint
npm run check:dist
```

The package has no runtime dependencies and no install hook of its own. Its development dependency
tree includes install hooks in the TypeScript runner's bundler and an optional file watcher. Install
the locked development toolchain with `npm ci --ignore-scripts`.

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

The content API publishes documentation from the latest successful scan. The scanner and every
content read enforce the same filename, filesystem, and size policy:

- Only exact directory/filename pairs from that scan are eligible. Startup builds the first index;
  `/api/entries` atomically replaces the index and its private filesystem identities. New files and
  replacements wait for a successful refresh. Scans visit collection entries and immediate docs
  subfolders; they never recursively publish arbitrary descendants. Empty bundles are omitted.
- Hidden segments and dotfiles are denied by default. An explicit, narrowly validated exception for
  a hidden collection root is described below. All other hidden segments remain denied.
- Case-insensitive denies cover `node_modules` segments and names beginning with `id_rsa`,
  `id_ed25519`, `credentials`, or `secrets`. A dot-delimited `env`, `pem`, `key`, `p12`, `pfx`,
  `sqlite`, or `db` component is denied before extension filtering. For example, `notes.env.md`,
  `notes.ENV.local.md`, `backup.pem.md`, and `db.sqlite.md` contribute neither membership nor search
  text to the scan and cannot be served.
- The complete extension allow-list is `.md`, `.mdx`, `.txt`, and `.html` (case-insensitive).
  Top-level docs files support all four; bundle lists exclude other formats. Images, SVG,
  JavaScript, JSON, archives, and extensionless files are unavailable.
- Paths must be canonical root-relative strings. Absolute paths, dot segments, empty interior
  segments, backslashes, colons, control characters, and residual percent escapes are denied.
  Parameters decode once. Use the exact spelling of `entry.dirPath` and a filename in `entry.files`.
  A configured root source `.` is represented by an empty `dirPath`.
- Every file and ancestor must remain inside the real project root, with exact on-disk spelling.
  All symlinks are refused, including links to safe targets. Files must be regular, have a link
  count of exactly **1**, and be at most **1 MiB (1,048,576 bytes)**. Every scan records device and
  inode identities for each published file and every parent directory, including the real root.
  Every read requires the complete chain to match, before and after its no-follow/non-blocking
  bounded read. Replacing a file or parent directory makes the file unavailable until a rescan,
  even if the new object is an otherwise ordinary allowed document. These content checks rely on
  the filesystem reporting stable device and inode numbers. Documentation trees with hard-linked
  files (link count above **1**) are not supported; such files are skipped by the scanner and
  refused on content reads.

Missing, malformed, denied, oversized, and unreadable content requests return the identical
`404 {"error":"Not found"}`. A listed document whose file or parent identity has changed returns
`409 {"error":"File changed since the last scan"}` without document text or filesystem details.
The viewer shows an unavailable state with a **Refresh** action that rescans and reloads through
`/api/entries`. Generated filesystem errors and error hooks contain no absolute paths or underlying
filesystem exceptions. Request logging is caller-controlled and receives the raw URL.

### Explicit hidden collection roots

Consumers may keep documentation in `.studies`, `.plans`, or `.specs` by opting in explicitly on the
shared config used by both the scanner and the server:

```ts
const config: KnowledgeDashboardKit_Config = {
  ...existingConfig,
  collections: [
    { type: "studies", dir: ".studies", color: "#60a5fa", icon: "microscope" },
    { type: "plans", dir: ".plans", color: "#34d399", icon: "map" },
    { type: "specs", dir: ".specs", color: "#8b5cf6", icon: "clipboard" },
  ],
  allowedHiddenCollectionRoots: [".studies", ".plans", ".specs"],
};
```

Names must be direct children of the project root, spelled as `.` followed by a lowercase ASCII
letter and then lowercase ASCII letters, digits, underscores, or hyphens. Invalid options throw
before startup or scanning. Separators, percent escapes, colons, control characters, `.` and `..`,
trailing dots/spaces, uppercase, and non-ASCII are rejected. The fixed never-list also rejects every
name beginning with `.env` or `.git`, and the exact names `.ssh`, `.aws`, `.gnupg`, `.npmrc`, `.npm`,
`.docker`, `.kube`, `.config`, `.netrc`, `.pypirc`, `.azure`, `.gcloud`, `.cache`, `.local`, `.vscode`,
and `.idea`, compared case-insensitively. Configuration cannot exempt these names.

An exception applies only to that exact first segment of a configured collection whose `dir` is
exactly that name. It does not authorize hidden docs sources, another occurrence of the same name,
hidden descendants, dotfiles, direct files beside collection entries, or unindexed files. All other
deny rules, containment, symlink, regular-file, link-count, identity, size, and budget checks remain.
Hidden-root content queries must encode **both** values exactly with `encodeURIComponent`, as the
bundled viewer does. Case, Unicode, percent-encoding variants, and filesystem aliases do not widen
access. This option preserves useful documentation conventions without treating arbitrary hidden
configuration directories as publishable content.

### Browser requests and rendering

Every `/api/*` request requires `X-Knowledge-Dashboard: 1`. The bundled viewer sends it on every API
call; custom clients and shells must do the same. Present `Sec-Fetch-Site` must be `same-origin` or
`none`. Requests with `cross-site`, `same-site`, or any other value are refused even when `Origin`
is absent. This prevents other pages from triggering API reads or rescans through ordinary browser
subresource requests. Cross-origin script needs a preflight to send the custom header: all `OPTIONS`
requests are refused and no `Access-Control-*` response headers are emitted. The header is a browser
request barrier, not a secret or authentication mechanism for native clients.

The shell remains reachable by normal top-level navigation. When supplied, `Sec-Fetch-Mode` must be
`navigate` and `Sec-Fetch-Dest` must be `document`; cross-site or same-site navigation requires both.
Script, image, frame, and fetch subresource requests are refused. Clients sending none of these
metadata headers can still load the shell, subject to Host and Origin checks. Unknown non-API paths
retain the trusted-shell fallback; unknown `/api/*` paths return 404 after API validation.

Raw documents, including HTML and MDX, are inert `text/plain; charset=utf-8`, with `nosniff`,
`Cache-Control: no-store`, and a CSP disabling scripts and sandboxing direct navigation. API JSON
also declares UTF-8. The shell CSP allows its exact inline script hashes, local API connections,
inline styles, and its data-URL favicon. Inline event handlers and remote scripts are blocked.
Markdown previews escape document HTML inside an opaque iframe with an empty `sandbox` attribute
and a separate CSP denying resource loads, scripts, forms, and base URLs. HTML, text, and source
views use `textContent`. External images, active links, diagram execution, syntax highlighting, and
remote rendering libraries are removed; fenced code stays readable as text. Custom `htmlFilePath`
shells are trusted application code and must comply with the CSP and API header requirement.

### Binding, Host, and Origin

The server binds to **127.0.0.1 by default**. It accepts the exact bound loopback Host and actual
port, including an ephemeral `port: 0`. `localhost` is not an implicit alias for `127.0.0.1`.
Additional authorities require exact `allowedHosts` entries; wildcards and automatic advertised-router
trust are refused. Duplicate Host/Origin headers are rejected. A present Origin must equal the HTTP
origin of the accepted Host; foreign and `null` origins return 403. Forwarded headers are not trusted.
GET and HEAD are supported. Other methods return 405 after Host/Origin validation (a foreign Origin
may instead cause 403), with no CORS headers.

```ts
const server = knowledgeDashboardKitStartServer({
  config,
  env: {},
  projectRoot: process.cwd(),
  port: 4317,
  host: "0.0.0.0", // Explicitly expose eligible documents beyond loopback.
  allowedHosts: ["docs.example.test:4317"],
});
```

A non-loopback bind exposes eligible documents to clients that can reach the listener and send an
accepted Host. Host, Origin, fetch metadata, and the custom header are not authentication. Remote
access requires a deliberately trusted deployment. HTTPS proxy origins are rejected by this strict
HTTP-origin rule.

### Scan budgets, timeouts, and public contracts

Each scan defaults to at most **10,000 entries** and **64 MiB (67,108,864 bytes) of document reads**.
Optional `config.scanLimits.maxEntries` and `config.scanLimits.maxTotalBytes` accept positive safe
integers. Budgets are shared across all collections and docs sources. Each document in a bundle is
read once, including secondary files; bytes are reserved before reading, so the read budget is never
exceeded. Unreadable reads may consume a conservative reservation. If either limit would be exceeded,
the whole scan and content allow-list are discarded. `/api/entries` returns HTTP 200 with empty
`entries`, zero counts, a timestamp, and `error: "Scan budget exceeded"`, without a filesystem path.
The viewer displays that error. A later successful refresh restores access.

| Server timeout | Configured value |
| --- | --- |
| Headers | 10,000 ms |
| Request | 15,000 ms |
| Keep-alive | 5,000 ms |
| Socket inactivity, with socket destruction | 15,000 ms |

Public function signatures and existing entry field types remain stable. Config gains optional
`allowedHiddenCollectionRoots` and `scanLimits`; `KnowledgeDashboardKit_ScanResult` gains the optional
literal `error` field. Treat `slug` as an opaque identity: flat docs now use the source label plus
full root-relative filename (including extension), and docs bundles use the label plus full directory
with a trailing `/`. Old docs bookmark slugs change. This distinguishes `hostile.md`, `hostile.mdx`,
`hostile.html`, and `hostile.txt` and keeps the viewer's selection tied to the correct document.
Collection slugs retain their existing format. A bundle without Markdown selects its first allowed
text document as its main file.

### Trust boundary and residual limits

A local writer can still place secret text in an ordinary allowed document, including modifying the
same inode after a scan; filename rules cannot classify that text. The configured project root and
shell file, configuration, and hooks are trusted. Identity checks detect persistent replacement but
portable Node APIs cannot provide an atomic directory-relative traversal boundary against a malicious
concurrent ancestor replacement. These checks do not claim to solve that race.

Scans remain synchronous. Entry and byte budgets bound published rows and document reads, but do not
bound directory enumeration, the count of empty files in one bundle, or CPU/wall-clock time. HTTP
timeouts do not interrupt a synchronous scan. This helper has no rate limit, authentication, or TLS.

### Validation

Run `npm ci --ignore-scripts`, `npm run build`, `npm run type-check`, and `npm test`. The package has
**no runtime dependencies and no install hook in this package**. Development dependencies contain
transitive install hooks, so development installs use `npm ci --ignore-scripts`. `dist/` is committed
and must equal a fresh build. The supported engine range is `>=22.0.0 <27`; checks run on Node 22, 24 and 26.

Tests use synthetic temporary files only, real ephemeral HTTP listeners, raw request targets, scan
membership/search-text non-disclosure assertions, non-empty positive controls, hard links, changed
file/parent identities, hidden roots and aliases, size/budget boundaries, fetch metadata, and actual
viewer code in a minimal DOM. They do not perform full browser-engine, hostile concurrent-writer,
or cross-platform filesystem testing.
