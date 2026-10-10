import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { root, referenceBuild, fileHash } from './trace-build-info.mjs';
import { phonemeProsodyBinary, phonemeProsodyInputs, phonemeProsodyRoot, phonemeProsodySource } from './phoneme-prosody-build-info.mjs';

const inputs = phonemeProsodyInputs();
mkdirSync(phonemeProsodyRoot, { recursive: true });
const compiler = readFileSync(path.join(referenceBuild, 'CMakeCache.txt'), 'utf8')
  .match(/^CMAKE_C_COMPILER:FILEPATH=(.+)$/m)?.[1];
assert(compiler, 'Missing C compiler from reference build');
const args = [
  '-std=c11', '-O2', '-Wall', '-Wextra', '-fwrapv', '-DLIBESPEAK_NG_EXPORT=1',
  ...['src/include', 'src/include/compat', 'src/ucd-tools/src/include', 'src/libespeak-ng']
    .map(name => '-I' + path.join(root, 'upstream/espeak-ng', name)),
  '-I' + path.join(referenceBuild, 'src/libespeak-ng/include'),
  phonemeProsodySource,
  ...inputs.libraries.map(row => path.join(referenceBuild, row.path)),
  '-lm', '-o', phonemeProsodyBinary,
];
execFileSync(compiler, args, { timeout: 60000, stdio: 'inherit' });
assert.deepEqual(phonemeProsodyInputs(), inputs, 'Inputs changed while building phoneme-prosody oracle');
writeFileSync(path.join(phonemeProsodyRoot, 'build-stamp.json'), JSON.stringify({
  schemaVersion: 1,
  inputs,
  compiler,
  compilerVersion: execFileSync(compiler, ['--version'], { encoding: 'utf8' }).split('\n')[0],
  compileArguments: args,
  binarySha256: fileHash(phonemeProsodyBinary),
  boundary: 'Original MakePhonemeList + CalcPitches + CalcLengths staged outputs',
}, null, 2) + '\n');
console.log('Built original phoneme prosody oracle.');
