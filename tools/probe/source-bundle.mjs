// Produce local corresponding-source companions for a probe delivery, including
// uncommitted project changes. Git's ignore rules exclude dependencies, keys,
// device photos and generated binaries. No remote or upload is involved.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const config = JSON.parse(readFileSync(path.join(root, 'upstream.json'), 'utf8'));
const packagePath = process.argv[2] || 'apps/vela-probe';
const packageManifest = JSON.parse(readFileSync(path.join(root, packagePath, 'package.json'), 'utf8'));
const version = packageManifest.version;
const output = path.join(root, 'artifacts', path.basename(packagePath) + '-' + version + '-sources');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 256 * 1024 * 1024 });
const source = path.join(root, 'upstream/espeak-ng');
if (git('-C', source, 'rev-parse', 'HEAD').toString().trim() !== config.commit ||
    git('-C', source, 'status', '--porcelain').length) throw new Error('Expected clean pinned upstream source');

const files = [...new Set(git('ls-files', '--cached', '--others', '--exclude-standard', '-z').toString('utf8').split('\0').filter(Boolean))]
  .filter(file => existsSync(path.join(root, file))).sort();
for (const file of files) {
  if (path.isAbsolute(file) || file.split('/').includes('..') || !lstatSync(path.join(root, file)).isFile()) {
    throw new Error('Only ordinary project source files can be archived: ' + file);
  }
}
const sourceManifest = files.map(file => ({ path: file, sha256: hash(readFileSync(path.join(root, file))) }));
mkdirSync(output, { recursive: true });
const projectTar = execFileSync('tar', ['--format=posix', '--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner',
  '--pax-option=delete=atime,delete=ctime', '-C', root, '-cf', '-', '--null', '--verbatim-files-from', '-T', '-'], {
  input: files.join('\0') + '\0', maxBuffer: 256 * 1024 * 1024
});
const upstreamTar = git('-C', source, 'archive', '--format=tar', '--prefix=espeak-ng/', config.commit);
const archives = [];
for (const [name, bytes] of [['jspeak-source.tar.gz', gzipSync(projectTar)], ['espeak-ng-source.tar.gz', gzipSync(upstreamTar)]]) {
  writeFileSync(path.join(output, name), bytes);
  archives.push({ name, byteLength: bytes.length, sha256: hash(bytes) });
}
// Build tools intentionally verify the original Git commit and a clean tree.
// A source tar alone cannot restore that identity; ship the public repository
// objects/ref in a bundle, without local Git config, credentials or hooks.
const bundleName = 'espeak-ng.git.bundle';
git('-C', source, 'bundle', 'create', path.join(output, bundleName), 'HEAD');
const bundle = readFileSync(path.join(output, bundleName));
archives.push({ name: bundleName, byteLength: bundle.length, sha256: hash(bundle) });
// Refuse to describe a snapshot if another writer changed it during archiving.
for (const entry of sourceManifest) {
  if (hash(readFileSync(path.join(root, entry.path))) !== entry.sha256) throw new Error('Source changed during archive: ' + entry.path);
}
writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({
  schemaVersion: 1, packagePath, version, upstreamCommit: config.commit,
  projectHead: git('rev-parse', 'HEAD').toString().trim(),
  projectDirty: git('status', '--porcelain').length > 0,
  sourceFingerprint: hash(JSON.stringify(sourceManifest)), archives, files: sourceManifest,
  build: 'Extract jspeak-source.tar.gz into a fresh project directory. Restore upstream/espeak-ng with git clone --no-checkout /path/to/espeak-ng.git.bundle upstream/espeak-ng, then git -C upstream/espeak-ng checkout --detach ' + config.commit + '. Follow docs/SOURCE_BUNDLE.md, README.md and docs/DATA_PACK.md. The plain upstream source tar is an inspection companion, not a substitute for the pinned Git checkout.'
}, null, 2) + '\n');
console.log('Source companions: ' + output);
for (const archive of archives) console.log(archive.name + ' SHA256 ' + archive.sha256);
