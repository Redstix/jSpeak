import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { root, config, traceRoot, traceSource, traceBuild, patchPath, sha256, fileHash, git, sourceDiff, buildIdentity, validateReference } from './trace-build-info.mjs';

const run = (exe, args) => execFileSync(exe, args, { cwd: root, stdio: 'inherit', env: { ...process.env, JSPEAK_TRACE_FILE: '' } });
const reference = validateReference();
mkdirSync(traceRoot, { recursive: true });
if (!existsSync(traceSource)) {
  run('git', ['clone', '--shared', '--no-hardlinks', path.join(root, 'upstream/espeak-ng'), traceSource]);
  run('git', ['-C', traceSource, 'checkout', '--detach', config.commit]);
}
assert.equal(git(traceSource, ['rev-parse', 'HEAD']), config.commit, 'Trace checkout differs from pinned commit');
if (git(traceSource, ['status', '--porcelain']) === '') {
  run('git', ['-C', traceSource, 'apply', '--check', patchPath]);
  run('git', ['-C', traceSource, 'apply', patchPath]);
  run('git', ['-C', traceSource, 'add', '-N', 'src/libespeak-ng/jstrace.c', 'src/libespeak-ng/jstrace.h']);
}
assert.equal(sha256(sourceDiff()), fileHash(patchPath), 'Refusing unknown edits in trace source; create a fresh isolated checkout to change patches');
assert.equal(git(traceSource, ['ls-files', '--others', '--exclude-standard']), '', 'Unknown trace source files');
run('cmake', ['-S', traceSource, '-B', traceBuild, ...config.cmakeOptions]);
run('cmake', ['--build', traceBuild, '--parallel', '2']);
run('cmake', ['--build', traceBuild, '--target', 'tests', '--parallel', '2']);
const instrumented = buildIdentity(traceBuild);
assert.equal(instrumented.dataFingerprint, reference.dataFingerprint, 'Instrumentation changed compiled data');
const compiler = execFileSync('cc', ['--version'], { encoding: 'utf8' }).split('\n')[0];
writeFileSync(path.join(traceRoot, 'build-stamp.json'), JSON.stringify({
  schemaVersion: 1, upstreamCommit: config.commit, cmakeOptions: config.cmakeOptions,
  patchSha256: fileHash(patchPath), compiler, platform: process.platform, arch: process.arch,
  reference, instrumented
}, null, 2) + '\n');
console.log('PASS: isolated trace build; compiled data is byte-identical to clean reference.');
