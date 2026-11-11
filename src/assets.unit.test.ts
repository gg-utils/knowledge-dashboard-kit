/** Exercises the actual inline viewer code without a browser or remote dependencies. */
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

/**
 * Runs the viewer with a minimal DOM that records which node receives document content.
 * @param file - Current document filename.
 * @param tab - Rendered or source view.
 * @param content - Potentially hostile document text.
 * @returns The node created by the actual viewer code, serialized across the VM boundary.
 */
function renderPreview(file: string, tab: string, content: string) {
  const html = fs.readFileSync(new URL("../assets/index.html", import.meta.url), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/u)?.[1];
  assert.ok(script);
  const context = vm.createContext({ console, setTimeout, clearTimeout });
  vm.runInContext(`
    const nodes = [];
    const area = { replaceChildren() { nodes.length = 0; }, appendChild(node) { nodes.push(node); } };
    const document = {
      getElementById() { return area; },
      createElement(tag) { return { tag, attributes: {}, style: {}, setAttribute(key, value) { this.attributes[key] = value; } }; }
    };
    ${script.slice(script.indexOf("/**\n * Displays source"), script.indexOf("// == Interactions"))}
    ${script.slice(script.indexOf("function stripFrontmatter"), script.indexOf("function formatDate"))}
  `, context);
  context.file = file;
  context.tab = tab;
  context.content = content;
  vm.runInContext("let selectedFile = file; let activeTab = tab; let rawContent = content; renderContentBody();", context);
  return JSON.parse(String(vm.runInContext("JSON.stringify(nodes[0])", context))) as {
    tag: string; attributes: Record<string, string>; srcdoc?: string; textContent?: string;
  };
}

test("Markdown previews escape document HTML and live in an opaque script-disabled sandbox", () => {
  const node = renderPreview("guide.md", "rendered", '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n# Guide\n\n[link](javascript:alert(1))');
  assert.equal(node.tag, "iframe");
  assert.equal(node.attributes.sandbox, "");
  assert.equal(node.attributes.referrerpolicy, "no-referrer");
  assert.match(node.srcdoc ?? "", /default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'/u);
  assert.match(node.srcdoc ?? "", /&lt;script&gt;/u);
  assert.match(node.srcdoc ?? "", /<h1>Guide<\/h1>/u);
  assert.doesNotMatch(node.srcdoc ?? "", /<script|<img/iu);
});

test("HTML, plain text, and the source tab are assigned only through textContent", () => {
  const content = '<script>alert(1)</script><img src=x onerror=alert(1)>';
  for (const [file, tab] of [["page.html", "rendered"], ["notes.txt", "rendered"], ["guide.md", "source"]]) {
    const node = renderPreview(file, tab, content);
    assert.equal(node.tag, "div");
    assert.equal(node.textContent, content);
    assert.equal(node.srcdoc, undefined);
  }
});

test("the shell needs no remote scripts or inline event handlers", () => {
  const html = fs.readFileSync(new URL("../assets/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc\s*=/iu);
  assert.doesNotMatch(html, /\bon(?:click|change|error|load)\s*=/iu);
});
