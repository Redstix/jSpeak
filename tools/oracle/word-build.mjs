import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { root, referenceBuild, fileHash } from './trace-build-info.mjs';
import { wordRoot, wordSource, wordBinary, wordSafetyBinary, wordInputs } from './word-build-info.mjs';
const inputs = wordInputs();
const compiler = readFileSync(path.join(referenceBuild, 'CMakeCache.txt'), 'utf8').match(/^CMAKE_C_COMPILER:FILEPATH=(.+)$/m)?.[1]; assert(compiler);
mkdirSync(wordRoot, { recursive: true });
const args = ['-std=c11', '-O2', '-Wall', '-Wextra', '-fwrapv', '-DLIBESPEAK_NG_EXPORT=1',
  ...['src/include', 'src/include/compat', 'src/ucd-tools/src/include', 'src/libespeak-ng'].map(name => '-I' + path.join(root, 'upstream/espeak-ng', name)),
  '-I' + path.join(referenceBuild, 'src/libespeak-ng/include'), wordSource,
  ...inputs.libraries.map(entry => path.join(referenceBuild, entry.path)), '-lm', '-o', wordBinary];
execFileSync(compiler, args, { timeout: 60000, stdio: 'inherit' });
const safetyFlags = ['-std=c11', '-O1', '-g', '-fwrapv', '-fsanitize=address', '-fno-omit-frame-pointer', '-DLIBESPEAK_NG_EXPORT=1',
  ...['src/include', 'src/include/compat', 'src/ucd-tools/src/include', 'src/libespeak-ng'].map(name => '-I' + path.join(root, 'upstream/espeak-ng', name)),
  '-I' + path.join(referenceBuild, 'src/libespeak-ng/include')];
const safetyCommands = [], safetyObjects = [];
for (const name of ['dictionary.c', 'common.c']) {
  const target = path.join(wordRoot, name + '.asan.o');
  const command = [...safetyFlags, '-c', path.join(root, 'upstream/espeak-ng/src/libespeak-ng', name), '-o', target];
  execFileSync(compiler, command, { timeout: 60000, stdio: 'inherit' }); safetyCommands.push(command);
  safetyObjects.push({ path: path.basename(target), sha256: fileHash(target) });
}
const safetyLink = [...safetyFlags, wordSource, ...safetyObjects.map(entry => path.join(wordRoot, entry.path)),
  ...inputs.libraries.map(entry => path.join(referenceBuild, entry.path)), '-lm', '-o', wordSafetyBinary];
execFileSync(compiler, safetyLink, { timeout: 60000, stdio: 'inherit' });
assert.deepEqual(wordInputs(), inputs);
writeFileSync(path.join(wordRoot, 'build-stamp.json'), JSON.stringify({ schemaVersion: 1, inputs, compiler,
  compilerVersion: execFileSync(compiler, ['--version'], { encoding: 'utf8' }).split('\n')[0], compileArguments: args, binarySha256: fileHash(wordBinary),
  safetyCommands, safetyObjects, safetyLink, safetyBinarySha256: fileHash(wordSafetyBinary) }, null, 2) + '\n');
console.log('Built original TranslateWord/TranslateWord3/TranslateWordWithBounds oracle and ASAN source preflight.');
