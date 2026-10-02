import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const config = JSON.parse(readFileSync(path.join(root, 'upstream.json'), 'utf8'));
const source = path.join(root, 'upstream/espeak-ng');
const run = (exe, args) => execFileSync(exe, args, { cwd: root, stdio: 'inherit' });
if (!existsSync(source)) {
  mkdirSync(path.dirname(source), { recursive: true });
  run('git', ['clone', config.repository, source]);
  run('git', ['-C', source, 'checkout', '--detach', config.commit]);
}
const commit = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['-C', source, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
if (commit !== config.commit || dirty) throw new Error('Upstream checkout differs from clean pinned commit; refusing to build');
run('cmake', ['-S', source, '-B', path.join(root, 'build/oracle'), ...config.cmakeOptions]);
run('cmake', ['--build', path.join(root, 'build/oracle'), '--parallel', '2']);
const hash = data => createHash('sha256').update(data).digest('hex');
const stamp = {
  upstreamCommit: config.commit,
  cmakeOptions: config.cmakeOptions,
  executableSha256: hash(readFileSync(path.join(root, 'build/oracle/src/espeak-ng'))),
  cmakeCacheSha256: hash(readFileSync(path.join(root, 'build/oracle/CMakeCache.txt')))
};
writeFileSync(path.join(root, 'build/oracle/build-stamp.json'), JSON.stringify(stamp, null, 2) + '\n');
