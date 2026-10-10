import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const config = JSON.parse(readFileSync(path.join(root, 'upstream.json'), 'utf8'));
export const traceRoot = path.join(root, 'build/oracle-trace');
export const traceSource = path.join(traceRoot, 'source');
export const traceBuild = path.join(traceRoot, 'build');
export const referenceBuild = path.join(root, 'build/oracle');
export const patchPath = path.join(root, 'tools/oracle/patches/frontend-trace.patch');
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const fileHash = name => sha256(readFileSync(name));
export const git = (source, args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
export function dataManifest(directory, prefix = '') {
  return readdirSync(directory).sort().flatMap(name => {
    const target = path.join(directory, name);
    return statSync(target).isDirectory() ? dataManifest(target, prefix + name + '/') :
      [{ path: prefix + name, bytes: statSync(target).size, sha256: fileHash(target) }];
  });
}
export function buildIdentity(build) {
  return {
    executableSha256: fileHash(path.join(build, 'src/espeak-ng')),
    cmakeCacheSha256: fileHash(path.join(build, 'CMakeCache.txt')),
    configHeaderSha256: fileHash(path.join(build, 'src/libespeak-ng/include/config.h')),
    dataFingerprint: sha256(JSON.stringify(dataManifest(path.join(build, 'espeak-ng-data'))))
  };
}
export function validateReference() {
  const source = path.join(root, 'upstream/espeak-ng');
  assert.equal(git(source, ['rev-parse', 'HEAD']), config.commit, 'Reference source commit changed');
  assert.equal(git(source, ['status', '--porcelain']), '', 'Reference source is dirty');
  const stamp = JSON.parse(readFileSync(path.join(referenceBuild, 'build-stamp.json'), 'utf8'));
  const identity = buildIdentity(referenceBuild);
  assert.equal(stamp.upstreamCommit, config.commit, 'Rebuild reference: commit changed');
  assert.deepEqual(stamp.cmakeOptions, config.cmakeOptions, 'Rebuild reference: options changed');
  for (const key of ['executableSha256', 'cmakeCacheSha256']) assert.equal(identity[key], stamp[key], `Reference ${key} changed`);
  return identity;
}
export function sourceDiff() {
  // Compare HEAD to the working tree, including staged changes and intent-to-add entries.
  return execFileSync('git', ['-C', traceSource, 'diff', 'HEAD', '--no-ext-diff', '--binary']);
}
export function validateTraceBuild() {
  const stamp = JSON.parse(readFileSync(path.join(traceRoot, 'build-stamp.json'), 'utf8'));
  assert.equal(stamp.schemaVersion, 1, 'Unknown trace build stamp');
  assert.equal(stamp.upstreamCommit, config.commit, 'Trace source commit changed');
  assert.equal(git(traceSource, ['rev-parse', 'HEAD']), config.commit, 'Trace checkout moved');
  assert.deepEqual(stamp.cmakeOptions, config.cmakeOptions, 'Trace options changed');
  assert.equal(stamp.patchSha256, fileHash(patchPath), 'Trace patch changed: rebuild');
  assert.equal(sha256(sourceDiff()), stamp.patchSha256, 'Trace source differs from versioned patch');
  assert.equal(git(traceSource, ['ls-files', '--others', '--exclude-standard']), '', 'Unknown trace source files');
  assert.deepEqual(stamp.reference, validateReference(), 'Reference build or data changed: rebuild trace');
  assert.deepEqual(stamp.instrumented, buildIdentity(traceBuild), 'Trace binary/config/data changed: rebuild');
  assert.equal(stamp.instrumented.dataFingerprint, stamp.reference.dataFingerprint, 'Trace changed compiled data');
  return { stamp, fingerprint: sha256(JSON.stringify(stamp)) };
}
