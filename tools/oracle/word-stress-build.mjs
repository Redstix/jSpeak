import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { root, referenceBuild, fileHash } from './trace-build-info.mjs';
import { wordStressRoot, wordStressSource, wordStressBinary, wordStressInputs } from './word-stress-build-info.mjs';
const inputs = wordStressInputs();
const compiler = readFileSync(path.join(referenceBuild, 'CMakeCache.txt'), 'utf8').match(/^CMAKE_C_COMPILER:FILEPATH=(.+)$/m)?.[1];
assert(compiler, 'Missing reference C compiler');
mkdirSync(wordStressRoot, { recursive: true });
const args = ['-std=c11', '-O2', '-Wall', '-Wextra', '-DLIBESPEAK_NG_EXPORT=1',
  ...['src/include', 'src/include/compat', 'src/ucd-tools/src/include', 'src/libespeak-ng'].map(name => '-I' + path.join(root, 'upstream/espeak-ng', name)),
  '-I' + path.join(referenceBuild, 'src/libespeak-ng/include'), wordStressSource,
  path.join(referenceBuild, 'src/libespeak-ng/libespeak-ng.a'), path.join(referenceBuild, 'src/ucd-tools/libucd.a'), '-lm', '-o', wordStressBinary];
execFileSync(compiler, args, { timeout: 60000, stdio: 'inherit' });
assert.deepEqual(wordStressInputs(), inputs, 'Reference changed during word-stress helper build');
writeFileSync(path.join(wordStressRoot, 'build-stamp.json'), JSON.stringify({ schemaVersion: 1, inputs, compiler,
  compilerVersion: execFileSync(compiler, ['--version'], { encoding: 'utf8' }).split('\n')[0], compileArguments: args, binarySha256: fileHash(wordStressBinary) }, null, 2) + '\n');
console.log('Built independent GetVowelStress/SetWordStress C oracle.');
