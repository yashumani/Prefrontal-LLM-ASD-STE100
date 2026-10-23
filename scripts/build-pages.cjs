/* Build a public static site from an explicit application/presentation allowlist. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');

const root = path.resolve(__dirname, '..');
const outputFlag = process.argv.indexOf('--output');
const output = path.resolve(root, outputFlag >= 0 ? process.argv[outputFlag + 1] : '_site');
if (path.dirname(output) !== root || path.basename(output) !== '_site') {
  throw new Error('Build output must be the repository _site directory.');
}
const application = [
  'index.html', 'styles.css', 'app.mjs', 'core.mjs', 'formats.mjs', 'demo.mjs',
  'benchmark.json',
  'guides/quickstart.html', 'guides/developer.html', 'guides/scaling.html',
];
const presentation = [
  'best-practices.html', 'motion-preview.html', 'decisions.html', 'story.html',
  'index.html', 'styles.css', 'app.js', 'diagrams.js', 'cost-lab.js', 'cost-lab.css',
  'presentation-content.json',
];
for (const name of application) if (!fs.statSync(path.join(root, 'workspace', name)).isFile()) throw new Error(`Missing application file: ${name}`);
for (const name of presentation) if (!fs.statSync(path.join(root, name)).isFile()) throw new Error(`Missing presentation file: ${name}`);

const commitFlag = process.argv.indexOf('--commit');
const git = cp.spawnSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'});
const commit = commitFlag >= 0 ? process.argv[commitFlag + 1] : (git.status === 0 ? git.stdout.trim() : 'local-archive');
if (!/^(?:[a-f0-9]{40}|local-archive)$/.test(commit || '')) throw new Error('Build commit must be an exact SHA or local-archive.');
const status = cp.spawnSync('git', ['status', '--porcelain', '--untracked-files=normal'], {cwd: root, encoding: 'utf8'});
const dirty = status.status === 0 && Boolean(status.stdout.trim());
const buildLabel = dirty ? 'local-uncommitted' : commit;
// The resolved deletion target is fixed to this repository's _site directory.
fs.rmSync(output, {recursive: true, force: true});
fs.mkdirSync(output);
function copy(source, destination) {
  const target = path.join(output, destination);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.copyFileSync(path.join(root, source), target);
}
for (const name of application) copy(path.join('workspace', name), name);
for (const name of presentation) copy(name, path.join('presentation', name));
fs.writeFileSync(path.join(output, '.nojekyll'), '');
const index = path.join(output, 'index.html');
fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replaceAll('__PREFRONTAL_BUILD__', buildLabel));
const files = [...application, ...presentation.map(name => `presentation/${name}`), '.nojekyll'];
const manifest = {
  schema: 'prefrontal.pages.build.v1', source_commit: dirty ? null : commit,
  base_commit: commit, source_tree_dirty: dirty,
  application: 'browser-local context workspace',
  data_uploads: false, backend: 'disconnected',
  files: files.sort().map(name => ({path: name, bytes: fs.statSync(path.join(output, name)).size,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(output, name))).digest('hex')})),
};
fs.writeFileSync(path.join(output, 'release.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({output, source_commit: manifest.source_commit, source_tree_dirty: dirty, files: files.length + 1,
  bytes: manifest.files.reduce((total, file) => total + file.bytes, 0), private_artifacts: false}));
