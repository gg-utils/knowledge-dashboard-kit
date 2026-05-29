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

The current scripts expect a source-first workspace toolchain.

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
