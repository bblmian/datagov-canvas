// Writes dist/THIRD_PARTY_LICENSES.txt: the license texts of every npm package that ends up in the
// bundle. Minification drops the license comments, and Apache-2.0 (@dbml/core, @dbml/parse), MIT,
// ISC and BSD all require shipping the notices with the extension.
// The DBML worker is a separate Rollup build whose chunk reaches the page build only as an asset,
// so the same plugin runs in both (vite.config.ts `worker.plugins`) and they share `found`.
// Some packages ship pre-bundled builds with their own dependencies inlined (@dbml/core carries
// antlr4, lodash, luxon, parsimmon, pluralize; @dbml/parse carries lodash-es, luxon, pathe), so the
// dependencies of every found package are listed too. That may add a few that tree-shaking dropped.
// A package that ships no license file gets its upstream text from scripts/licenses/<name>.txt;
// the build fails if neither exists, so a new dependency can't slip through without its notice.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const NM = '/node_modules/';
const fallbackDir = join(dirname(fileURLToPath(import.meta.url)), 'licenses');
const found = new Map(); // package dir → { name, version, license, homepage, texts }

function packageDir(id) {
  const file = id.replace(/^\0/, '').split('?')[0];
  const i = file.lastIndexOf(NM);
  if (i < 0) return null;
  const parts = file.slice(i + NM.length).split('/');
  return file.slice(0, i + NM.length) + parts.slice(0, parts[0].startsWith('@') ? 2 : 1).join('/');
}

// Node's lookup: <dir>/node_modules/<name>, then each enclosing node_modules up to the top one.
function resolveDep(dir, name) {
  for (let p = dir; ; p = p.slice(0, p.lastIndexOf(NM))) {
    const candidate = join(p, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (!p.includes(NM)) return null;
  }
}

function record(dir) {
  if (found.has(dir) || !existsSync(join(dir, 'package.json'))) return;
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  if (pkg.name.startsWith('@types/')) return; // type declarations never reach the bundle
  const texts = readdirSync(dir)
    .filter((f) => /^(licen[cs]e|copying|notice)([.-].*)?$/i.test(f))
    .sort()
    .map((f) => readFileSync(join(dir, f), 'utf8').trim());
  const fallback = join(fallbackDir, `${pkg.name.replace('/', '__')}.txt`);
  if (!texts.length && existsSync(fallback)) texts.push(readFileSync(fallback, 'utf8').trim());
  const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  found.set(dir, { name: pkg.name, version: pkg.version, license: pkg.license ?? 'UNKNOWN', homepage: pkg.homepage ?? repo, texts });
  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    const depDir = resolveDep(dir, dep);
    if (depDir) record(depDir);
  }
}

function collect(bundle) {
  for (const chunk of Object.values(bundle)) {
    if (chunk.type !== 'chunk') continue;
    for (const [id, m] of Object.entries(chunk.modules)) {
      const dir = m.renderedLength > 0 && packageDir(id);
      if (dir) record(dir);
    }
  }
}

/** For `worker.plugins`: records the packages bundled into the worker. */
export function collectLicenses() {
  return { name: 'collect-licenses', apply: 'build', generateBundle(_, bundle) { collect(bundle); } };
}

/** For the page build: records its packages and emits the combined file. */
export function thirdPartyLicenses() {
  return {
    name: 'third-party-licenses',
    apply: 'build',
    generateBundle(_, bundle) {
      collect(bundle);
      const pkgs = [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
      const missing = pkgs.filter((p) => !p.texts.length).map((p) => p.name);
      if (missing.length) this.error(`no license text for ${missing.join(', ')}: add scripts/licenses/<name>.txt`);
      const rule = '-'.repeat(78);
      const body = pkgs.map((p) => [
        rule,
        `${p.name}@${p.version} — ${p.license}${p.homepage ? `\n${p.homepage}` : ''}`,
        '',
        p.texts.join('\n\n'),
      ].join('\n'));
      const source = [
        'DataGov Canvas includes the following third-party software.',
        `${pkgs.length} packages, listed with their licenses.`,
        '',
        ...body,
        '',
      ].join('\n');
      this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_LICENSES.txt', source });
    },
  };
}
