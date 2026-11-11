/** Real HTTP regression coverage using synthetic documents and secrets in temporary directories. */
import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import { request, type IncomingHttpHeaders } from "node:http";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { KNOWLEDGE_DASHBOARD_MAX_DOCUMENT_BYTES } from "./content-policy.js";
import { knowledgeDashboardKitScanAll } from "./scan.js";
import { knowledgeDashboardKitStartServer } from "./server.js";
import { knowledgeDashboardKitTestConfig } from "./test-config.unit.js";
import type { KnowledgeDashboardKit_Config, KnowledgeDashboardKit_StartServerOptions } from "./types.js";

const FAKE_SECRET = "SYNTHETIC_SECRET_MUST_NEVER_BE_SERVED";

/**
 * Creates a real ephemeral server and a disposable, fully synthetic filesystem tree.
 * @param t - Test context that owns cleanup.
 * @param overrides - Explicit server options for binding and error-path tests.
 * @returns The server, filesystem fixture, and an HTTP helper enforcing non-disclosure.
 */
async function makeFixture(t: TestContext, overrides: Partial<KnowledgeDashboardKit_StartServerOptions> = {}) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-security-"));
  const root = path.join(temporary, "root");
  fs.mkdirSync(root);
  const denied = [".env", "docs/bundle/.env.local", ".git/config", ".ssh/id_rsa", ".npmrc",
    ".studies/entry/study.md", "CREDENTIALS.md", "SECRETS.txt", "KEY.PEM", "NODE_MODULES/README.md",
    "key.pem", "key.key", "key.p12", "key.pfx", "id_rsa.md", "id_ed25519.txt",
    "credentials.md", "secrets.html", "data.sqlite", "data.db", "node_modules/readme.md",
    "docs/bundle/credentials-guide.md", "docs/bundle/secrets-notes.txt", "docs/bundle/.hidden.md"];
  for (const relative of denied) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), FAKE_SECRET);
  }
  fs.writeFileSync(path.join(root, "README.md"), "# Public documentation");
  fs.writeFileSync(path.join(root, "docs/bundle/guide.md"), "# Bundle guide");
  fs.writeFileSync(path.join(root, "guide.mdx"), "# MDX is text");
  fs.writeFileSync(path.join(root, "notes.txt"), "Plain documentation");
  fs.writeFileSync(path.join(root, "page.html"), '<script>globalThis.compromised = true</script>');
  fs.writeFileSync(path.join(root, "script.js"), FAKE_SECRET);
  fs.writeFileSync(path.join(root, "image.svg"), FAKE_SECRET);
  fs.writeFileSync(path.join(root, "large.md"), Buffer.alloc(KNOWLEDGE_DASHBOARD_MAX_DOCUMENT_BYTES + 1));
  fs.mkdirSync(path.join(root, "unindexed/deep"), { recursive: true });
  fs.writeFileSync(path.join(root, "unindexed/deep/hidden.md"), FAKE_SECRET);
  fs.writeFileSync(path.join(temporary, "outside.md"), FAKE_SECRET);
  fs.symlinkSync(path.join(temporary, "outside.md"), path.join(root, "escape.md"));
  fs.symlinkSync(path.join(root, ".env"), path.join(root, "alias.md"));
  fs.symlinkSync(path.join(root, "README.md"), path.join(root, "safe-alias.md"));
  fs.symlinkSync(temporary, path.join(root, "linked-directory"));
  fs.mkdirSync(path.join(root, "directory.md"));
  const logs: string[] = [];
  const config: KnowledgeDashboardKit_Config = { ...knowledgeDashboardKitTestConfig, collections: [],
    docsSources: [{ repoLabel: "test", dir: "." }, { repoLabel: "docs", dir: "docs" }] };
  const server = knowledgeDashboardKitStartServer({ config, env: {}, port: 0, projectRoot: root,
    hooks: { log: () => {}, error: (line, error) => logs.push(`${line} ${String(error ?? "")}`) }, ...overrides });
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    fs.rmSync(temporary, { recursive: true, force: true });
  });
  await once(server, "listening");
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  const port = address.port;

  /**
   * Sends an unnormalized HTTP request and rejects disclosure in every response body.
   * @param target - Raw HTTP target, without URL normalization by a fetch client.
   * @param headers - Explicit header map or raw header pairs, including duplicate-header tests.
   * @param method - HTTP method to exercise.
   * @returns Status, headers, and a response body checked for synthetic secrets and root paths.
   */
  async function get(target: string, headers: Record<string, string | undefined> | string[] = {}, method = "GET") {
    return await new Promise<{ status: number; body: string; headers: IncomingHttpHeaders }>((resolve, reject) => {
      const req = request({ hostname: "127.0.0.1", port, path: target, method, headers }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => { body += chunk; });
        res.on("end", () => {
          try {
            assert.ok(!body.includes(FAKE_SECRET), "a synthetic secret must never appear in a response");
            assert.ok(!body.includes(root), "responses must not disclose absolute paths");
            resolve({ status: res.statusCode ?? 0, body, headers: res.headers });
          } catch (error: unknown) { reject(error); }
        });
        res.on("error", reject);
      });
      req.on("error", reject);
      req.end();
    });
  }
  return { root, temporary, config, denied, server, port, get, logs };
}

/**
 * Encodes the two public content parameters exactly as the dashboard does.
 * @param directory - Scanner entry directory.
 * @param file - Requested filename or hostile test value.
 * @returns The encoded HTTP request target.
 */
function contentTarget(directory: string, file: string): string {
  return `/api/entry-content?${new URLSearchParams({ path: directory, file })}`;
}

/**
 * Checks the common inert-response and privacy headers without assuming a response type.
 * @param headers - Headers returned by the real server.
 * @returns Nothing; assertions fail when a required header is absent.
 */
function assertSafeHeaders(headers: IncomingHttpHeaders): void {
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["cache-control"], "no-store");
  assert.match(String(headers["content-security-policy"]), /default-src 'none'/u);
  assert.equal(headers["access-control-allow-origin"], undefined);
  assert.match(String(headers["content-type"]), /charset=utf-8/u);
}

test("serves scanned documents as inert text with security headers and loopback binding", async (t) => {
  const fixture = await makeFixture(t);
  const address = fixture.server.address();
  assert.ok(address !== null && typeof address !== "string");
  assert.equal(address.address, "127.0.0.1");
  for (const [directory, file] of [["", "README.md"], ["", "guide.mdx"], ["", "notes.txt"],
    ["", "page.html"], ["docs/bundle", "guide.md"]]) {
    const response = await fixture.get(contentTarget(directory, file));
    assert.equal(response.status, 200);
    assert.equal(response.headers["content-type"], "text/plain; charset=utf-8");
    assert.match(String(response.headers["content-security-policy"]), /sandbox/u);
    assertSafeHeaders(response.headers);
  }
  const head = await fixture.get(contentTarget("", "README.md"), {}, "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.body, "");
  for (const target of ["/", "/api/status", "/api/entries"]) {
    const response = await fixture.get(target);
    assert.equal(response.status, 200);
    assertSafeHeaders(response.headers);
  }
  const shell = await fixture.get("/");
  assert.match(String(shell.headers["content-security-policy"]), /script-src 'sha256-/u);
  assert.match(String(shell.headers["content-security-policy"]), /script-src-attr 'none'/u);
});

test("denies secrets, unindexed files, directories, symlinks, and path parser bypasses uniformly", async (t) => {
  const fixture = await makeFixture(t);
  const denied = [...fixture.denied, "escape.md", "alias.md", "safe-alias.md", "linked-directory/outside.md",
    "script.js", "image.svg", "large.md", "directory.md", "unindexed/deep/hidden.md"];
  for (const relative of denied) {
    const directory = path.posix.dirname(relative) === "." ? "" : path.posix.dirname(relative);
    const basename = path.posix.basename(relative);
    const variants = [contentTarget(directory, basename), contentTarget("", relative),
      contentTarget("docs", `../${relative}`), contentTarget("", `docs/../${relative}`),
      contentTarget("", relative.replaceAll("/", "\\")), contentTarget("", `docs\\..\\${relative}`),
      contentTarget("", path.join(fixture.root, relative)), contentTarget(path.join(fixture.root, directory), basename),
      contentTarget("", `${relative}\0`), contentTarget("", `C:\\${relative}`),
      `/api/entry-content?path=docs&file=%2e%2e%2f${encodeURIComponent(relative)}`,
      `/api/entry-content?path=&file=%2f${encodeURIComponent(relative)}`,
      `/api/entry-content?path=docs&file=%252e%252e%252f${encodeURIComponent(relative)}`,
      `/api/entry-content?path=docs&file=%2e%2e%5c${encodeURIComponent(relative)}`];
    for (const target of variants) {
      const response = await fixture.get(target);
      assert.equal(response.status, 404, target);
      assert.deepEqual(JSON.parse(response.body), { error: "Not found" });
    }
  }
  for (const target of [contentTarget("", "../outside.md"), contentTarget("../", "outside.md"),
    "/api/entry-content", "/api/entry-content?path=&file=README.md&file=.env",
    "/api/entry-content?path=&path=docs&file=README.md", contentTarget("", "README.md%00"),
    "/api/entry-content?path=%2e%2e%2f&file=outside.md", "/api/entry-content?path=%252f&file=README.md",
    "/api/entry-content?path=&file=%zz", contentTarget("docs/..", "README.md"),
    contentTarget("", path.join(fixture.root, "README.md")), contentTarget("docs", "../README.md"),
    `http://attacker.invalid/api/status`]) {
    assert.equal((await fixture.get(target)).status, 404, target);
  }
  for (const target of ["/docs/", "/.git/", "/node_modules/"]) {
    const response = await fixture.get(target);
    assert.equal(response.status, 200); // The existing shell fallback never becomes a directory listing.
    assert.match(response.body, /<!DOCTYPE html>/iu);
  }
});

test("scanner shares hard denies even for explicitly configured hidden or outside roots", async (t) => {
  const fixture = await makeFixture(t);
  const scan = knowledgeDashboardKitScanAll({ config: fixture.config, projectRoot: fixture.root });
  const listed = scan.entries.flatMap((entry) => entry.files.map((file) => [entry.dirPath, file].filter(Boolean).join("/")));
  assert.ok(listed.includes("README.md"));
  assert.ok(listed.includes("docs/bundle/guide.md"));
  assert.ok(!JSON.stringify(scan).includes(FAKE_SECRET));
  for (const relative of [...fixture.denied, "escape.md", "alias.md", "safe-alias.md", "large.md", "script.js", "image.svg"]) {
    assert.ok(!listed.includes(relative), relative);
  }
  for (const dir of [".git", ".studies", ".", "../", fixture.temporary, "node_modules", "linked-directory"]) {
    const config = { ...fixture.config, docsSources: dir === "." ? [] : [{ repoLabel: "denied", dir }],
      collections: [{ ...knowledgeDashboardKitTestConfig.collections[0], dir }] };
    const result = knowledgeDashboardKitScanAll({ config, projectRoot: fixture.root });
    // A collection rooted at '.' may expose only safe, scanned subfolder documents.
    if (dir === ".") {
      assert.ok(result.entries.every((entry) => entry.files.every((file) => /\.(?:md|mdx|txt|html)$/iu.test(file))));
    } else assert.equal(result.entries.length, 0, dir);
  }
});

test("refreshes the exact allow-list and refuses files replaced after scanning", async (t) => {
  const fixture = await makeFixture(t);
  fs.writeFileSync(path.join(fixture.root, "new.md"), "New documentation");
  assert.equal((await fixture.get(contentTarget("", "new.md"))).status, 404);
  await fixture.get("/api/entries");
  assert.equal((await fixture.get(contentTarget("", "new.md"))).status, 200);
  fs.writeFileSync(path.join(fixture.root, "limit.txt"), Buffer.alloc(KNOWLEDGE_DASHBOARD_MAX_DOCUMENT_BYTES, "x"));
  await fixture.get("/api/entries");
  assert.equal((await fixture.get(contentTarget("", "limit.txt"))).body.length, KNOWLEDGE_DASHBOARD_MAX_DOCUMENT_BYTES);
  fs.unlinkSync(path.join(fixture.root, "README.md"));
  fs.symlinkSync(path.join(fixture.root, ".env"), path.join(fixture.root, "README.md"));
  assert.equal((await fixture.get(contentTarget("", "README.md"))).status, 404);
  fs.unlinkSync(path.join(fixture.root, "new.md"));
  fs.symlinkSync(path.join(fixture.temporary, "outside.md"), path.join(fixture.root, "new.md"));
  assert.equal((await fixture.get(contentTarget("", "new.md"))).status, 404);
  fs.writeFileSync(path.join(fixture.root, "notes.txt"), Buffer.alloc(KNOWLEDGE_DASHBOARD_MAX_DOCUMENT_BYTES + 1));
  assert.equal((await fixture.get(contentTarget("", "notes.txt"))).status, 404);
  fs.unlinkSync(path.join(fixture.root, "guide.mdx"));
  fs.mkdirSync(path.join(fixture.root, "guide.mdx"));
  assert.equal((await fixture.get(contentTarget("", "guide.mdx"))).status, 404);
  await fixture.get("/api/entries");
});

test("rejects untrusted Host and Origin headers on every route without permissive CORS", async (t) => {
  const fixture = await makeFixture(t);
  for (const target of ["/", "/api/status", "/api/entries", contentTarget("", "README.md")]) {
    for (const headers of [{ Host: "attacker.invalid" }, { Host: `localhost:${fixture.port}` },
      { Host: `127.0.0.1:${fixture.port + 1}` }, { Origin: "https://attacker.invalid" },
      { Origin: "null" }, { Origin: `http://127.0.0.1:${fixture.port}/` }]) {
      const response = await fixture.get(target, headers);
      assert.equal(response.status, 403);
      assertSafeHeaders(response.headers);
    }
    assert.equal((await fixture.get(target, { Origin: `http://127.0.0.1:${fixture.port}` })).status, 200);
  }
  assert.equal((await fixture.get("/api/status", ["Host", `127.0.0.1:${fixture.port}`, "Host", "attacker.invalid"])).status, 403);
  assert.equal((await fixture.get("/api/status", ["Host", `127.0.0.1:${fixture.port}`, "Origin", `http://127.0.0.1:${fixture.port}`, "Origin", "https://attacker.invalid"])).status, 403);
  assert.equal((await fixture.get("/api/status", ["Host", ""])).status, 403);
  assert.equal((await fixture.get("/api/entries", {}, "POST")).status, 405);
  assert.equal((await fixture.get("/api/status", { Origin: "https://attacker.invalid" }, "OPTIONS")).status, 403);
});

test("non-loopback binding and additional Host authorities require explicit options", async (t) => {
  const fixture = await makeFixture(t, { host: "0.0.0.0", allowedHosts: ["docs.example.test:4317"] });
  assert.equal((await fixture.get("/api/status")).status, 403);
  assert.equal((await fixture.get("/api/status", { Host: "docs.example.test:4317", Origin: "http://docs.example.test:4317" })).status, 200);
  assert.equal((await fixture.get("/api/status", { Host: "docs.example.test:4317", Origin: "https://attacker.invalid" })).status, 403);
  for (const host of ["*.example.test", "http://example.test", "example.test/path", "user@example.test"]) {
    assert.throws(() => knowledgeDashboardKitStartServer({ config: fixture.config, env: {}, projectRoot: fixture.root,
      port: 0, allowedHosts: [host] }), /Invalid allowed Host authority/u);
  }
});

test("shell read failures keep response and hook errors free of absolute paths", async (t) => {
  const fixture = await makeFixture(t, { config: { ...knowledgeDashboardKitTestConfig, collections: [], docsSources: [],
    htmlFilePath: path.join(os.tmpdir(), "dashboard-missing-file", "index.html") } });
  const response = await fixture.get("/");
  assert.equal(response.status, 500);
  assertSafeHeaders(response.headers);
  assert.deepEqual(fixture.logs, ["Failed to load dashboard HTML. "]);
});
