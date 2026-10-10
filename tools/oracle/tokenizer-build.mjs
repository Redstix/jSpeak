import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { root, config, fileHash, sha256, git, buildIdentity, validateReference } from './trace-build-info.mjs';
import { tokenizerRoot, tokenizerSource, tokenizerBuild, tokenizerPatch, tokenizerHelperSource, tokenizerBinary, tokenizerBoundsObject, tokenizerDiff } from './tokenizer-build-info.mjs';
const run = (exe, args) => execFileSync(exe, args, { stdio: 'inherit', env: { ...process.env, JSPEAK_TRACE_FILE: '' } });
const reference = validateReference(); mkdirSync(tokenizerRoot, { recursive: true });
if (!existsSync(tokenizerSource)) {
  run('git', ['clone', '--shared', '--no-hardlinks', path.join(root, 'upstream/espeak-ng'), tokenizerSource]);
  run('git', ['-C', tokenizerSource, 'checkout', '--detach', config.commit]);
}
assert.equal(git(tokenizerSource, ['rev-parse', 'HEAD']), config.commit);
if (git(tokenizerSource, ['status', '--porcelain']) === '') {
  run('git', ['-C', tokenizerSource, 'apply', '--check', tokenizerPatch]);
  run('git', ['-C', tokenizerSource, 'apply', tokenizerPatch]);
  run('git', ['-C', tokenizerSource, 'add', '-N', 'src/libespeak-ng/jstokenizer.c', 'src/libespeak-ng/jstokenizer.h']);
}
assert.equal(sha256(tokenizerDiff()), fileHash(tokenizerPatch), 'Refusing unknown tokenizer source edits');
assert.equal(git(tokenizerSource, ['ls-files', '--others', '--exclude-standard']), '');
run('cmake', ['-S', tokenizerSource, '-B', tokenizerBuild, ...config.cmakeOptions]);
run('cmake', ['--build', tokenizerBuild, '--parallel', '2']);
const instrumented = buildIdentity(tokenizerBuild);
assert.equal(reference.dataFingerprint, instrumented.dataFingerprint, 'Tokenizer patch changed compiled data');
const compiler = readFileSync(path.join(tokenizerBuild, 'CMakeCache.txt'), 'utf8').match(/^CMAKE_C_COMPILER:FILEPATH=(.+)$/m)?.[1];
if (!compiler) throw new Error('No tokenizer C compiler');
const args = ['-std=c11', '-O2', '-Wall', '-Wextra', '-fwrapv', '-DLIBESPEAK_NG_EXPORT=1',
  ...['src/include', 'src/include/compat', 'src/ucd-tools/src/include', 'src/libespeak-ng'].map(p => '-I' + path.join(tokenizerSource, p)),
  '-I' + path.join(tokenizerBuild, 'src/libespeak-ng/include'), tokenizerHelperSource];
const libraries = Object.fromEntries(['src/libespeak-ng/libespeak-ng.a', 'src/ucd-tools/libucd.a'].map(p => [p, fileHash(path.join(tokenizerBuild, p))]));
// Retain the original array sizes and abort at their original out-of-bounds
// accesses. Only the development helper uses this object; the CLI is untouched.
const boundsFlags = ['-fsanitize=bounds', '-fno-sanitize-recover=bounds'];
const boundsArguments = [...args.slice(0, -1), ...boundsFlags, '-c', path.join(tokenizerSource, 'src/libespeak-ng/translate.c'), '-o', tokenizerBoundsObject];
run(compiler, boundsArguments);
run(compiler, [...args, ...boundsFlags, tokenizerBoundsObject, ...Object.keys(libraries).map(p => path.join(tokenizerBuild, p)), '-lm', '-o', tokenizerBinary]);
writeFileSync(path.join(tokenizerRoot, 'build-stamp.json'), JSON.stringify({ schemaVersion: 1, upstreamCommit: config.commit, cmakeOptions: config.cmakeOptions,
  patchSha256: fileHash(tokenizerPatch), reference, instrumented, libraries, compiler,
  compilerVersion: execFileSync(compiler, ['--version'], { encoding: 'utf8' }).split('\n')[0], compileArguments: args,
  helperSourceSha256: fileHash(tokenizerHelperSource), helperBinarySha256: fileHash(tokenizerBinary),
  boundsFlags, boundsArguments, boundsObjectSha256: fileHash(tokenizerBoundsObject)
}, null, 2) + '\n');
console.log('Built isolated tokenizer boundary and original static-primitive reference.');
