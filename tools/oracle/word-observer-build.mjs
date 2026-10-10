import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { root, referenceBuild, validateReference, fileHash, sha256 } from './trace-build-info.mjs';
const directory = path.join(root, 'build/oracle-word-observer'); mkdirSync(directory, { recursive: true });
const sources = ['tools/oracle/word-observer.c', 'tools/oracle/word-shared.h'];
const reference = validateReference();
const inputs = [...sources.map(name => ({ path: name, sha256: fileHash(path.join(root, name)) })),
  ...['src/CMakeFiles/espeak-ng-bin.dir/espeak-ng.c.o', 'src/libespeak-ng/libespeak-ng.a', 'src/ucd-tools/libucd.a'].map(name => ({ path: path.relative(root, path.join(referenceBuild, name)), sha256: fileHash(path.join(referenceBuild, name)) }))];
const compiler = readFileSync(path.join(referenceBuild, 'CMakeCache.txt'), 'utf8').match(/^CMAKE_C_COMPILER:FILEPATH=(.+)$/m)?.[1]; assert(compiler);
const object = path.join(directory, 'word-observer.o'), binary = path.join(directory, 'espeak-ng');
const compile = ['-std=c11', '-O2', '-Wall', '-Wextra', '-fwrapv', '-DLIBESPEAK_NG_EXPORT=1',
  ...['src/include', 'src/include/compat', 'src/ucd-tools/src/include', 'src/libespeak-ng'].map(name => '-I' + path.join(root, 'upstream/espeak-ng', name)),
  '-I' + path.join(referenceBuild, 'src/libespeak-ng/include'), '-c', path.join(root, sources[0]), '-o', object];
const link = ['-Wl,--wrap=TranslateWord3', path.join(referenceBuild, 'src/CMakeFiles/espeak-ng-bin.dir/espeak-ng.c.o'), object,
  path.join(referenceBuild, 'src/libespeak-ng/libespeak-ng.a'), path.join(referenceBuild, 'src/ucd-tools/libucd.a'), '-lm', '-o', binary];
execFileSync(compiler, compile, { stdio: 'inherit', timeout: 60000 }); execFileSync(compiler, link, { stdio: 'inherit', timeout: 60000 });
assert.deepEqual(validateReference(), reference); for (const entry of inputs) assert.equal(fileHash(path.join(root, entry.path)), entry.sha256);
const stamp = { schemaVersion: 1, kind: 'readonly-original-TranslateWord3-link-wrapper', reference, inputs, compiler,
  compilerVersion: execFileSync(compiler, ['--version'], { encoding: 'utf8' }).split('\n')[0], compile, link, objectSha256: fileHash(object), binarySha256: fileHash(binary) };
writeFileSync(path.join(directory, 'build-stamp.json'), JSON.stringify(stamp, null, 2) + '\n');
console.log('Built independent read-only word CLI observer. Fingerprint: ' + sha256(JSON.stringify(stamp)));
