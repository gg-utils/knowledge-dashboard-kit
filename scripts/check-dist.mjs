import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';

function snapshot(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const filename = join(entry.parentPath, entry.name);
      return [relative(directory, filename), readFileSync(filename).toString('base64')];
    }).sort(([a], [b]) => a.localeCompare(b));
}
// A sibling directory preserves relative source-map paths without changing dist/.
const temporary = mkdtempSync('.dist-check-');
try {
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json', '--outDir', temporary], { stdio: 'inherit' });
  if (JSON.stringify(snapshot('dist')) !== JSON.stringify(snapshot(temporary))) {
    console.error('dist/ differs from a fresh build. Run npm run build, remove obsolete output, and commit dist/.');
    process.exitCode = 1;
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
