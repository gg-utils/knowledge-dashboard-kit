/** Real HTTP regression coverage using synthetic documents and secrets in temporary directories. */
import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import { request, type IncomingHttpHeaders } from "node:http";
import os from "node:os";
import vm from "node:vm";
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
    ".studies/.private/study.md", "CREDENTIALS.md", "SECRETS.txt", "KEY.PEM", "NODE_MODULES/README.md",
    "key.pem", "key.key", "key.p12", "key.pfx", "id_rsa.md", "id_ed25519.txt",
    "credentials.md", "secrets.html", "data.sqlite", "data.db", "node_modules/readme.md",
    "notes.env.md", "notes.ENV.local.md", "backup.pem.md", "backup.KEY.mdx", "backup.p12.txt", "backup.pfx.html", "db.sqlite.md", "backup.db.md",
    "docs/bundle/notes.env.md", "docs/bundle/credentials-guide.md", "docs/bundle/secrets-notes.txt", "docs/bundle/.hidden.md"];
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
    // Preserve full hook values so path-disclosure assertions also cover unexpected errors.
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
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
      const requestHeaders = Array.isArray(headers) ? headers : Object.fromEntries(Object.entries({ "X-Knowledge-Dashboard": "1", ...headers }).filter(([, value]) => value !== undefined));
      const req = request({ hostname: "127.0.0.1", port, path: target, method, headers: requestHeaders }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => { body += chunk; });
        res.on("end", () => {
          try {
            assert.ok(!body.includes(FAKE_SECRET), "a synthetic secret must never appear in a response");
            assert.ok(!body.includes(root), "responses must not disclose absolute paths");
            resolve({ status: res.statusCode ?? 0, body, headers: res.headers });
          } catch (error: unknown) { reject(error instanceof Error ? error : new Error("Unexpected non-Error assertion failure")); }
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

void test("serves scanned documents as inert text with security headers and loopback binding", async (t) => {
  const fixture = await makeFixture(t);
  const address = fixture.server.address();
  assert.ok(address !== null && typeof address !== "string");
  assert.equal(address.address, "127.0.0.1");
  for (const [directory, file] of [["", "README.md"], ["", "guide.mdx"], ["", "notes.txt"],
    ["", "page.html"], ["docs/bundle", "guide.md"]] as const) {
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

void test("denies secrets, unindexed files, directories, symlinks, and path parser bypasses uniformly", async (t) => {
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

void test("scanner shares hard denies even for explicitly configured hidden or outside roots", async (t) => {
  const fixture = await makeFixture(t);
  const scan = knowledgeDashboardKitScanAll({ config: fixture.config, projectRoot: fixture.root });
  const listed = scan.entries.flatMap((entry) => entry.files.map((file) => [entry.dirPath, file].filter(Boolean).join("/")));
  assert.ok(listed.includes("README.md"));
  assert.ok(listed.includes("docs/bundle/guide.md"));
  assert.ok(!JSON.stringify(scan).includes(FAKE_SECRET));
  for (const relative of [...fixture.denied, "escape.md", "alias.md", "safe-alias.md", "large.md", "script.js", "image.svg"]) {
    assert.ok(!listed.includes(relative), relative);
  }
  for (const dir of [".git", ".studies", "../", fixture.temporary, "node_modules", "linked-directory"]) {
    const config = { ...fixture.config, docsSources: [{ repoLabel: "denied", dir }],
      collections: [{ ...firstCollection(), dir }] };
    const result = knowledgeDashboardKitScanAll({ config, projectRoot: fixture.root });
    assert.equal(result.entries.length, 0, dir);
    assert.ok(!JSON.stringify(result).includes(FAKE_SECRET));
  }
});

void test("refreshes the exact allow-list and refuses files replaced after scanning", async (t) => {
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

void test("rejects untrusted Host and Origin headers on every route without permissive CORS", async (t) => {
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

void test("non-loopback binding and additional Host authorities require explicit options", async (t) => {
  const fixture = await makeFixture(t, { host: "0.0.0.0", allowedHosts: ["docs.example.test:4317"] });
  assert.equal((await fixture.get("/api/status")).status, 403);
  assert.equal((await fixture.get("/api/status", { Host: "docs.example.test:4317", Origin: "http://docs.example.test:4317" })).status, 200);
  assert.equal((await fixture.get("/api/status", { Host: "docs.example.test:4317", Origin: "https://attacker.invalid" })).status, 403);
  for (const host of ["*.example.test", "http://example.test", "example.test/path", "user@example.test"]) {
    assert.throws(() => knowledgeDashboardKitStartServer({ config: fixture.config, env: {}, projectRoot: fixture.root,
      port: 0, allowedHosts: [host] }), /Invalid allowed Host authority/u);
  }
});

void test("shell read failures keep response and hook errors free of absolute paths", async (t) => {
  const fixture = await makeFixture(t, { config: { ...knowledgeDashboardKitTestConfig, collections: [], docsSources: [],
    htmlFilePath: path.join(os.tmpdir(), "dashboard-missing-file", "index.html") } });
  const response = await fixture.get("/");
  assert.equal(response.status, 500);
  assertSafeHeaders(response.headers);
  assert.deepEqual(fixture.logs, ["Failed to load dashboard HTML. "]);
});


void test("API requests require viewer intent and reject foreign fetch metadata without Origin", async (t) => {
  const fixture = await makeFixture(t);
  for (const target of ["/api/status", "/api/entries", contentTarget("", "README.md"), "/api/unknown"]) {
    assert.equal((await fixture.get(target, { "X-Knowledge-Dashboard": undefined })).status, 403);
    for (const site of ["cross-site", "same-site", "unexpected"]) {
      assert.equal((await fixture.get(target, { "Sec-Fetch-Site": site })).status, 403);
    }
    for (const site of ["same-origin", "none"]) {
      const response = await fixture.get(target, { "Sec-Fetch-Site": site, "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty" });
      assert.equal(response.status, target === "/api/unknown" ? 404 : 200);
    }
  }
  for (const headers of [
    { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Dest": "script" },
    { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Dest": "image" },
    { "Sec-Fetch-Dest": "script" }, { "Sec-Fetch-Dest": "image" }, { "Sec-Fetch-Mode": "cors" },
    { "Sec-Fetch-Site": "same-site" },
  ]) assert.equal((await fixture.get("/", headers)).status, 403);
  for (const headers of [{}, { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document" },
    { "Sec-Fetch-Site": "none", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document" },
    { "Sec-Fetch-Site": "same-site", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document" }]) {
    assert.equal((await fixture.get("/", headers)).status, 200);
  }
  for (const headers of [{}, { Origin: "https://attacker.invalid", "Access-Control-Request-Headers": "X-Knowledge-Dashboard" }]) {
    const response = await fixture.get("/api/entries", headers, "OPTIONS");
    assert.ok([403, 405].includes(response.status));
    for (const name of Object.keys(response.headers)) assert.ok(!name.startsWith("access-control-"));
  }
  assert.equal(fixture.server.headersTimeout, 10_000);
  assert.equal(fixture.server.requestTimeout, 15_000);
  assert.equal(fixture.server.keepAliveTimeout, 5_000);
  assert.equal(fixture.server.timeout, 15_000);
});

void test("hard links and changed file or parent identities stay unavailable until refresh", async (t) => {
  const fixture = await makeFixture(t);
  fs.linkSync(path.join(fixture.root, ".env"), path.join(fixture.root, "hard.md"));
  const scan = await fixture.get("/api/entries");
  assert.equal(scan.status, 200);
  assert.ok(!scan.body.includes('"hard.md"'));
  assert.equal((await fixture.get(contentTarget("", "hard.md"))).status, 404);
  assert.equal((await fixture.get(contentTarget("", "README.md"))).status, 200);
  fs.writeFileSync(path.join(fixture.temporary, "editor-save.md"), "Replacement public text");
  fs.renameSync(path.join(fixture.temporary, "editor-save.md"), path.join(fixture.root, "README.md"));
  const changedFile = await fixture.get(contentTarget("", "README.md"));
  assert.equal(changedFile.status, 409);
  assert.deepEqual(JSON.parse(changedFile.body), { error: "File changed since the last scan" });
  assertSafeHeaders(changedFile.headers);
  assert.equal((await fixture.get(contentTarget("", "README.md"), {}, "HEAD")).status, 409);
  fs.renameSync(path.join(fixture.root, "docs/bundle"), path.join(fixture.temporary, "old-bundle"));
  fs.mkdirSync(path.join(fixture.root, "docs/bundle"));
  fs.renameSync(path.join(fixture.temporary, "old-bundle/guide.md"), path.join(fixture.root, "docs/bundle/guide.md"));
  const changedParent = await fixture.get(contentTarget("docs/bundle", "guide.md"));
  assert.equal(changedParent.status, 409);
  assert.deepEqual(JSON.parse(changedParent.body), { error: "File changed since the last scan" });
  await fixture.get("/api/entries");
  assert.equal((await fixture.get(contentTarget("", "README.md"))).body, "Replacement public text");
  assert.equal((await fixture.get(contentTarget("docs/bundle", "guide.md"))).body, "# Bundle guide");
  fs.linkSync(path.join(fixture.root, "README.md"), path.join(fixture.root, "new-hard.md"));
  assert.equal((await fixture.get(contentTarget("", "README.md"))).status, 404);
});

/** Requires the collection fixture before spreading it into test configurations. */
function firstCollection() {
  const collection = knowledgeDashboardKitTestConfig.collections[0];
  assert.ok(collection);
  return collection;
}

/** Creates an explicit hidden collection configuration for the synthetic server fixtures. */
function hiddenConfig(names: readonly string[]): KnowledgeDashboardKit_Config {
  return { ...knowledgeDashboardKitTestConfig, docsSources: [], allowedHiddenCollectionRoots: names,
    collections: (["studies", "plans", "specs"] as const).map((type) => ({
      dir: `.${type}`, type, color: "blue", icon: "document",
    })) };
}

void test("hidden-root permission does not reach a nested collection while exact and visible collections still serve", async (t) => {
  const fixture = await makeFixture(t, { config: {
    ...knowledgeDashboardKitTestConfig, docsSources: [], allowedHiddenCollectionRoots: [".studies"],
    collections: [
      { type: "studies", dir: ".studies", color: "blue", icon: "document" },
      { type: "plans", dir: ".studies/nested", color: "blue", icon: "document" },
      { type: "specs", dir: "studies", color: "blue", icon: "document" },
    ],
  } });
  for (const [directory, content] of [[".studies/public-entry", "Exact hidden collection"],
    [".studies/nested/private-entry", FAKE_SECRET], ["studies/visible-entry", "Visible collection"]] as const) {
    fs.mkdirSync(path.join(fixture.root, directory), { recursive: true });
    fs.writeFileSync(path.join(fixture.root, directory, "guide.md"), content);
  }
  for (let refresh = 0; refresh < 2; refresh++) {
    const response = await fixture.get("/api/entries");
    assert.equal(response.status, 200);
    const scan = JSON.parse(response.body) as { entries: { type: string; dirPath: string; files: string[] }[] };
    assert.deepEqual(scan.entries.map((entry) => [entry.type, entry.dirPath, entry.files]), [
      ["studies", ".studies/public-entry", ["guide.md"]],
      ["specs", "studies/visible-entry", ["guide.md"]],
    ]);
    const denied = await fixture.get(contentTarget(".studies/nested/private-entry", "guide.md"));
    assert.equal(denied.status, 404);
    assert.deepEqual(JSON.parse(denied.body), { error: "Not found" });
    for (const [directory, content] of [[".studies/public-entry", "Exact hidden collection"],
      ["studies/visible-entry", "Visible collection"]] as const) {
      const document = await fixture.get(contentTarget(directory, "guide.md"));
      assert.equal(document.status, 200);
      assert.equal(document.body, content);
    }
  }
});

void test("explicit hidden collection roots publish exact non-empty entries and retain all denies", async (t) => {
  const names = [".studies", ".plans", ".specs"];
  const fixture = await makeFixture(t, { config: hiddenConfig(names) });
  for (const name of names) {
    const directory = path.join(fixture.root, name, "public-entry");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "guide.md"), `Public ${name}`);
    for (const denied of ["notes.env.md", "notes.ENV.local.md", "backup.pem.md", ".hidden.md", "private/hidden.md", ".plans/hidden.md"]) {
      fs.mkdirSync(path.dirname(path.join(directory, denied)), { recursive: true });
      fs.writeFileSync(path.join(directory, denied), FAKE_SECRET);
    }
    fs.writeFileSync(path.join(fixture.root, name, "dotfile.md"), FAKE_SECRET);
    fs.symlinkSync(path.join(fixture.temporary, "outside.md"), path.join(directory, "linked.md"));
    fs.symlinkSync(directory, path.join(fixture.root, name, "linked-entry"));
    fs.linkSync(path.join(fixture.root, ".env"), path.join(directory, "hard.md"));
    fs.writeFileSync(path.join(directory, "large.md"), Buffer.alloc(KNOWLEDGE_DASHBOARD_MAX_DOCUMENT_BYTES + 1, "x"));
    assert.equal((await fixture.get(contentTarget(`${name}/public-entry`, "guide.md"))).status, 404);
  }
  const scanResponse = await fixture.get("/api/entries");
  assert.equal(scanResponse.status, 200);
  const scan = JSON.parse(scanResponse.body) as { entries: { dirPath: string; files: string[] }[] };
  assert.deepEqual(scan.entries.map((entry) => [entry.dirPath, entry.files]), names.map((name) => [`${name}/public-entry`, ["guide.md"]]));
  const defaultScan = knowledgeDashboardKitScanAll({ config: { ...hiddenConfig(names), allowedHiddenCollectionRoots: undefined }, projectRoot: fixture.root });
  assert.deepEqual(defaultScan.entries, []);
  assert.ok(!JSON.stringify(defaultScan).includes(FAKE_SECRET));
  for (const name of names) {
    const dir = `${name}/public-entry`;
    assert.equal((await fixture.get(contentTarget(dir, "guide.md"))).body, `Public ${name}`);
    for (const denied of ["notes.env.md", "notes.ENV.local.md", "backup.pem.md", ".hidden.md", "private/hidden.md", ".plans/hidden.md", "linked.md", "hard.md", "large.md"]) {
      assert.equal((await fixture.get(contentTarget(dir, denied))).status, 404);
    }
    for (const alias of [name.toUpperCase(), `${name}.`, `${name} `, `%2e${name.slice(1)}`, `${name}\u0301`, `docs/${name}`]) {
      assert.equal((await fixture.get(contentTarget(`${alias}/public-entry`, "guide.md"))).status, 404);
    }
    for (const target of [
      `/api/entry-content?path=%2e${name.slice(1)}%2Fpublic-entry&file=guide.md`,
      `/api/entry-content?path=${name}%2fpublic-entry&file=guide.md`,
      `/api/entry-content?path=${name}%2Fpublic-entry&file=%67uide.md`,
    ]) assert.equal((await fixture.get(target)).status, 404);
    assert.equal((await fixture.get(contentTarget(`${name}/linked-entry`, "guide.md"))).status, 404);
    assert.equal((await fixture.get(contentTarget(name, "dotfile.md"))).status, 404);
    fs.writeFileSync(path.join(fixture.root, dir, "new.md"), "Fresh public document");
    assert.equal((await fixture.get(contentTarget(dir, "new.md"))).status, 404);
  }
  await fixture.get("/api/entries");
  for (const name of names) assert.equal((await fixture.get(contentTarget(`${name}/public-entry`, "new.md"))).body, "Fresh public document");
  const dir = ".studies/public-entry";
  fs.renameSync(path.join(fixture.root, dir, "guide.md"), path.join(fixture.temporary, "original-guide"));
  fs.writeFileSync(path.join(fixture.root, dir, "guide.md"), FAKE_SECRET);
  assert.equal((await fixture.get(contentTarget(dir, "guide.md"))).status, 409);
  fs.renameSync(path.join(fixture.root, ".plans"), path.join(fixture.temporary, "original-plans"));
  fs.mkdirSync(path.join(fixture.root, ".plans/public-entry"), { recursive: true });
  fs.renameSync(path.join(fixture.temporary, "original-plans/public-entry/new.md"), path.join(fixture.root, ".plans/public-entry/new.md"));
  assert.equal((await fixture.get(contentTarget(".plans/public-entry", "new.md"))).status, 409);
  fs.renameSync(path.join(fixture.root, ".specs"), path.join(fixture.temporary, "original-specs"));
  fs.symlinkSync(path.join(fixture.temporary, "original-specs"), path.join(fixture.root, ".specs"));
  assert.equal((await fixture.get(contentTarget(".specs/public-entry", "guide.md"))).status, 404);
  // Remove the intentionally replaced allowed document before refresh: ordinary document text is trusted.
  fs.unlinkSync(path.join(fixture.root, dir, "guide.md"));
  const refreshed = await fixture.get("/api/entries");
  assert.equal(refreshed.status, 200);
  assert.ok(!refreshed.body.includes(".specs/public-entry"));
  assert.equal((await fixture.get(contentTarget(".plans/public-entry", "new.md"))).body, "Fresh public document");
});

void test("hidden root validation rejects every reserved family and noncanonical name at startup", async (t) => {
  const fixture = await makeFixture(t);
  const denied = [".env", ".env.local", ".environment", ".git", ".gitignore", ".github", ".ssh", ".aws", ".gnupg", ".npmrc", ".npm", ".docker", ".kube", ".config", ".netrc", ".pypirc", ".azure", ".gcloud", ".cache", ".local", ".vscode", ".idea",
    "", ".", "..", "studies", ".Studies", ".STUDIES", ".studiés", ".studies/child", "a/.studies", ".studies\\child", ".%73tudies", ".studies:stream", ".studies\0", ".studies\n", ".studies\u007f", ".studies.", ".studies "];
  assert.ok(denied.length > 30);
  for (const name of denied) {
    const config = hiddenConfig([name]);
    assert.throws(() => {
      const probe = knowledgeDashboardKitStartServer({ config, env: {}, projectRoot: fixture.root, port: 0 });
      probe.close();
    }, /Invalid hidden collection root/u, JSON.stringify(name));
    assert.throws(() => knowledgeDashboardKitScanAll({ config, projectRoot: fixture.root }), /Invalid hidden collection root/u);
  }
});

void test("scan budgets fail closed with a path-free error and recover on a later scan", async (t) => {
  for (const scanLimits of [{ maxEntries: 1, maxTotalBytes: 100_000 }, { maxEntries: 100, maxTotalBytes: 25 }]) {
    const fixture = await makeFixture(t, { config: { ...knowledgeDashboardKitTestConfig, collections: [],
      docsSources: [{ repoLabel: "public", dir: "." }], scanLimits } });
    const response = await fixture.get("/api/entries");
    assert.equal(response.status, 200);
    const scan = JSON.parse(response.body) as { entries: unknown[]; error?: string; counts: Record<string, number> };
    assert.equal(scan.error, "Scan budget exceeded");
    assert.deepEqual(scan.entries, []);
    assert.deepEqual(scan.counts, { docs: 0, plans: 0, specs: 0, studies: 0 });
    assert.equal((await fixture.get(contentTarget("", "README.md"))).status, 404);
    for (const file of ["guide.mdx", "notes.txt", "page.html"]) fs.unlinkSync(path.join(fixture.root, file));
    fs.rmSync(path.join(fixture.root, "docs"), { recursive: true });
    const recovered = JSON.parse((await fixture.get("/api/entries")).body) as { entries: unknown[]; error?: string };
    assert.equal(recovered.error, undefined);
    assert.equal(recovered.entries.length, 1);
    assert.equal((await fixture.get(contentTarget("", "README.md"))).body, "# Public documentation");
  }
});

void test("four documents with equal basenames have distinct selectable identities", async (t) => {
  const fixture = await makeFixture(t);
  const files = ["hostile.md", "hostile.mdx", "hostile.html", "hostile.txt"];
  for (const file of files) fs.writeFileSync(path.join(fixture.root, file), `Public ${file}`);
  const scan = JSON.parse((await fixture.get("/api/entries")).body) as { entries: { slug: string; files: string[] }[] };
  const entries = scan.entries.filter((entry) => entry.files[0] !== undefined && files.includes(entry.files[0]));
  assert.equal(entries.length, 4);
  assert.equal(new Set(entries.map((entry) => entry.slug)).size, 4);
  const html = fs.readFileSync(new URL("../assets/index.html", import.meta.url), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/u)?.[1];
  assert.ok(script);
  const selectEntry = script.slice(script.indexOf("function selectEntry("), script.indexOf("async function selectFile("));
  const selections = vm.runInNewContext(`
    const allEntries = ${JSON.stringify(entries.map((entry) => ({ ...entry, type: "docs" })))};
    let selectedEntry, selectedFile, rawContent, activeTab;
    const selections = [];
    function renderEntries() {} function renderFiles() {} function renderContent() {} function updateHash() {}
    function selectFile(file) { selections.push(file); }
    ${selectEntry}
    for (const entry of allEntries) selectEntry(entry.type, entry.slug);
    JSON.stringify(selections);
  `) as string;
  assert.deepEqual(JSON.parse(selections), entries.map((entry) => entry.files[0]));
  assert.deepEqual((JSON.parse(selections) as string[]).sort(), [...files].sort());
  for (const file of files) assert.equal((await fixture.get(contentTarget("", file))).body, `Public ${file}`);
});


void test("a root collection has an exact non-empty positive control beside denied files", async (t) => {
  const config = { ...knowledgeDashboardKitTestConfig, docsSources: [],
    collections: [{ ...firstCollection(), dir: "." }] };
  const fixture = await makeFixture(t, { config });
  fs.mkdirSync(path.join(fixture.root, "publishable"));
  fs.writeFileSync(path.join(fixture.root, "publishable/guide.md"), "Root collection positive control");
  const denied = ["notes.env.md", "backup.pem.md", ".hidden.md", "key.pem", "private/deep.md"];
  for (const file of denied) {
    fs.mkdirSync(path.dirname(path.join(fixture.root, "publishable", file)), { recursive: true });
    fs.writeFileSync(path.join(fixture.root, "publishable", file), FAKE_SECRET);
  }
  const scan = knowledgeDashboardKitScanAll({ config, projectRoot: fixture.root });
  assert.deepEqual(scan.entries.map((entry) => [entry.dirPath, entry.files]), [["publishable", ["guide.md"]]]);
  assert.ok(!JSON.stringify(scan).includes(FAKE_SECRET));
  const response = await fixture.get("/api/entries");
  assert.equal(response.status, 200);
  const payload = JSON.parse(response.body) as { entries: { dirPath: string; files: string[] }[] };
  assert.deepEqual(payload.entries.map((entry) => [entry.dirPath, entry.files]), [["publishable", ["guide.md"]]]);
  assert.equal((await fixture.get(contentTarget("publishable", "guide.md"))).body, "Root collection positive control");
  for (const file of denied) assert.equal((await fixture.get(contentTarget("publishable", file))).status, 404);
});


void test("omitting the hidden-root list denies otherwise publishable hidden documents over HTTP", async (t) => {
  const config = { ...hiddenConfig([]), allowedHiddenCollectionRoots: undefined };
  const fixture = await makeFixture(t, { config });
  const names = [".studies", ".plans", ".specs"];
  for (const name of names) {
    fs.mkdirSync(path.join(fixture.root, name, "public-entry"), { recursive: true });
    fs.writeFileSync(path.join(fixture.root, name, "public-entry/guide.md"), FAKE_SECRET);
  }
  const response = await fixture.get("/api/entries");
  assert.equal(response.status, 200);
  assert.deepEqual((JSON.parse(response.body) as { entries: unknown[] }).entries, []);
  for (const name of names) assert.equal((await fixture.get(contentTarget(`${name}/public-entry`, "guide.md"))).status, 404);
});

void test("scan limits accept exact boundaries, count secondary files, and reject invalid budgets", async (t) => {
  const body = "# Public documentation";
  const config = { ...knowledgeDashboardKitTestConfig, collections: [], docsSources: [{ repoLabel: "public", dir: "limited" }],
    scanLimits: { maxEntries: 1, maxTotalBytes: Buffer.byteLength(body) } };
  const fixture = await makeFixture(t, { config });
  fs.mkdirSync(path.join(fixture.root, "limited"));
  fs.writeFileSync(path.join(fixture.root, "limited/guide.md"), body);
  const exact = JSON.parse((await fixture.get("/api/entries")).body) as { entries: unknown[]; error?: string };
  assert.equal(exact.error, undefined);
  assert.equal(exact.entries.length, 1);
  assert.equal((await fixture.get(contentTarget("limited", "guide.md"))).body, body);
  fs.mkdirSync(path.join(fixture.root, "limited/bundle"));
  fs.renameSync(path.join(fixture.root, "limited/guide.md"), path.join(fixture.root, "limited/bundle/guide.md"));
  fs.writeFileSync(path.join(fixture.root, "limited/bundle/secondary.txt"), "x");
  const over = JSON.parse((await fixture.get("/api/entries")).body) as { entries: unknown[]; error?: string };
  assert.equal(over.error, "Scan budget exceeded");
  assert.deepEqual(over.entries, []);
  assert.equal((await fixture.get(contentTarget("limited/bundle", "guide.md"))).status, 404);
  for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    for (const scanLimits of [{ maxEntries: value }, { maxTotalBytes: value }]) {
      assert.throws(() => knowledgeDashboardKitScanAll({ config: { ...config, scanLimits }, projectRoot: fixture.root }), /Invalid scan budget/u);
    }
  }
});


void test("symlinks at hidden root, entry, and document depths never enter scan or content payloads", async (t) => {
  const fixture = await makeFixture(t, { config: hiddenConfig([".studies", ".plans", ".specs"]) });
  const outside = path.join(fixture.temporary, "link-target");
  fs.mkdirSync(path.join(outside, "entry"), { recursive: true });
  fs.writeFileSync(path.join(outside, "entry/guide.md"), FAKE_SECRET);
  fs.rmSync(path.join(fixture.root, ".studies"), { recursive: true });
  fs.symlinkSync(outside, path.join(fixture.root, ".studies"));
  for (const name of [".plans", ".specs"]) {
    fs.mkdirSync(path.join(fixture.root, name, "control"), { recursive: true });
    fs.writeFileSync(path.join(fixture.root, name, "control/guide.md"), `Public ${name}`);
  }
  fs.symlinkSync(path.join(outside, "entry"), path.join(fixture.root, ".plans/entry"));
  fs.symlinkSync(path.join(outside, "entry/guide.md"), path.join(fixture.root, ".specs/control/alias.md"));
  const response = await fixture.get("/api/entries");
  assert.equal(response.status, 200);
  const scan = JSON.parse(response.body) as { entries: { dirPath: string; files: string[] }[] };
  assert.deepEqual(scan.entries.map((entry) => [entry.dirPath, entry.files]), [
    [".plans/control", ["guide.md"]], [".specs/control", ["guide.md"]],
  ]);
  for (const name of [".plans", ".specs"]) assert.equal((await fixture.get(contentTarget(`${name}/control`, "guide.md"))).body, `Public ${name}`);
  for (const [dir, file] of [[".studies/entry", "guide.md"], [".plans/entry", "guide.md"], [".specs/control", "alias.md"]] as const) {
    assert.equal((await fixture.get(contentTarget(dir, file))).status, 404);
  }
});
