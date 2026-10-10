import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { root, referenceBuild, fileHash } from './trace-build-info.mjs';
import { encodeRoot, encodeSource, encodeBinary, encodeInputs } from './phoneme-encode-build-info.mjs';
const inputs = encodeInputs();
const compiler = readFileSync(path.join(referenceBuild, 'CMakeCache.txt'), 'utf8').match(/^CMAKE_C_COMPILER:FILEPATH=(.+)$/m)?.[1];
assert(compiler); mkdirSync(encodeRoot, { recursive: true });
const args = ['-std=c11', '-O2', '-Wall', '-Wextra', '-fwrapv', '-DLIBESPEAK_NG_EXPORT=1',
  ...['src/include', 'src/include/compat', 'src/ucd-tools/src/include', 'src/libespeak-ng'].map(name => '-I' + path.join(root, 'upstream/espeak-ng', name)),
  '-I' + path.join(referenceBuild, 'src/libespeak-ng/include'), encodeSource,
  ...inputs.libraries.map(entry => path.join(referenceBuild, entry.path)), '-lm', '-o', encodeBinary];
execFileSync(compiler, args, { timeout: 60000, stdio: 'inherit' });
assert.deepEqual(encodeInputs(), inputs);
writeFileSync(path.join(encodeRoot, 'build-stamp.json'), JSON.stringify({ schemaVersion: 1, inputs, compiler,
  compilerVersion: execFileSync(compiler, ['--version'], { encoding: 'utf8' }).split('\n')[0], compileArguments: args, binarySha256: fileHash(encodeBinary) }, null, 2) + '\n');
console.log('Built original EncodePhonemes C oracle.');
