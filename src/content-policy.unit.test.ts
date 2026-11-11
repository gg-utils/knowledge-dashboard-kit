/** Direct policy coverage for exceptions that scan membership would independently refuse. */
import assert from "node:assert/strict";
import test from "node:test";
import { knowledgeDashboardKitHiddenRoots, knowledgeDashboardKitIsDocumentPath } from "./content-policy.js";
import { knowledgeDashboardKitTestConfig } from "./test-config.unit.js";

void test("hidden-root exceptions apply only to the exact configured collection segment", () => {
  const names = [".studies", ".plans", ".specs"];
  const config = { ...knowledgeDashboardKitTestConfig, allowedHiddenCollectionRoots: names,
    collections: knowledgeDashboardKitTestConfig.collections.map((collection) => ({ ...collection, dir: `.${collection.dir}` })) };
  const hiddenRoots = knowledgeDashboardKitHiddenRoots(config);
  assert.equal(hiddenRoots.size, 3);
  for (const name of names) {
    assert.equal(knowledgeDashboardKitIsDocumentPath(`${name}/entry/guide.md`, hiddenRoots), true);
    for (const relative of [`docs/${name}/entry/guide.md`, `${name}/entry/${name}/guide.md`,
      `${name}/entry/.hidden.md`, `${name}/entry/notes.env.md`, `${name.toUpperCase()}/entry/guide.md`,
      `%2e${name.slice(1)}/entry/guide.md`, `${name}/entry/guide.md.`]) {
      assert.equal(knowledgeDashboardKitIsDocumentPath(relative, hiddenRoots), false, relative);
    }
  }
  const unconfigured = knowledgeDashboardKitHiddenRoots({ ...config, collections: [] });
  assert.equal(unconfigured.size, 0);
  assert.equal(knowledgeDashboardKitIsDocumentPath(".studies/entry/guide.md", unconfigured), false);
});
