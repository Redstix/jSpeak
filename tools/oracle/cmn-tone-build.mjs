import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { referenceBuild, root, fileHash } from './trace-build-info.mjs';
import { cmnToneBinary, cmnToneInputs, cmnToneRoot, cmnToneSource } from './cmn-tone-build-info.mjs';

const inputs = cmnToneInputs();
mkdirSync(cmnToneRoot, { recursive: true });
const compiler = readFileSync(path.join(referenceBuild, 'CMakeCache.txt'), 'utf8')
  .match(/^CMAKE_C_COMPILER:FILEPATH=(.+)$/m)?.[1];
assert(compiler, 'Missing C compiler from reference build');
const args = [
  '-std=c11', '-O2', '-Wall', '-Wextra', '-fwrapv', '-DLIBESPEAK_NG_EXPORT=1',
  ...['src/include', 'src/include/compat', 'src/ucd-tools/src/include', 'src/libespeak-ng']
    .map(name => '-I' + path.join(root, 'upstream/espeak-ng', name)),
  '-I' + path.join(referenceBuild, 'src/libespeak-ng/include'),
  cmnToneSource,
  ...inputs.libraries.map(row => path.join(referenceBuild, row.path)),
  '-lm', '-o', cmnToneBinary,
];
execFileSync(compiler, args, { timeout: 60000, stdio: 'inherit' });
assert.deepEqual(cmnToneInputs(), inputs, 'Inputs changed while building cmn tone oracle');
writeFileSync(path.join(cmnToneRoot, 'build-stamp.json'), JSON.stringify({
  schemaVersion: 1,
  inputs,
  compiler,
  compilerVersion: execFileSync(compiler, ['--version'], { encoding: 'utf8' }).split('\n')[0],
  compileArguments: args,
  binarySha256: fileHash(cmnToneBinary),
  boundary: 'Original cmn MakePhonemeList + CalcPitches_Tone staged outputs',
}, null, 2) + '\n');
console.log('Built original cmn tone oracle.');
