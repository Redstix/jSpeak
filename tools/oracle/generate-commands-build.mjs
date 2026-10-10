import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { root, referenceBuild, fileHash } from './trace-build-info.mjs';
import { generateCommandsBinary, generateCommandsInputs, generateCommandsRoot, generateCommandsSource } from './generate-commands-build-info.mjs';

const inputs = generateCommandsInputs();
mkdirSync(generateCommandsRoot, { recursive: true });
const observedHeader = path.join(generateCommandsRoot, 'synthesize-observed.h');
const observedSynthesizeSource = path.join(generateCommandsRoot, 'synthesize-observed.c');
const observedWavegenSource = path.join(generateCommandsRoot, 'wavegen-observed.c');
const originalHeader = readFileSync(path.join(root, 'upstream/espeak-ng/src/libespeak-ng/synthesize.h'), 'utf8');
const patchedHeader = originalHeader.replace('#define N_WCMDQ   170', '#define N_WCMDQ   4096');
assert.notEqual(patchedHeader, originalHeader, 'Unique N_WCMDQ header anchor');
writeFileSync(observedHeader, patchedHeader);
writeFileSync(observedSynthesizeSource, readFileSync(path.join(root, 'upstream/espeak-ng/src/libespeak-ng/synthesize.c')));
writeFileSync(observedWavegenSource, readFileSync(path.join(root, 'upstream/espeak-ng/src/libespeak-ng/wavegen.c')));
const compiler = readFileSync(path.join(referenceBuild, 'CMakeCache.txt'), 'utf8')
  .match(/^CMAKE_C_COMPILER:FILEPATH=(.+)$/m)?.[1];
assert(compiler, 'Missing C compiler from reference build');
const args = [
  '-std=gnu11', '-O2', '-Wall', '-Wextra', '-fwrapv', '-D_GNU_SOURCE', '-DLIBESPEAK_NG_EXPORT=1',
  '-include', observedHeader,
  ...['src/include', 'src/include/compat', 'src/ucd-tools/src/include', 'src/libespeak-ng']
    .map(name => '-I' + path.join(root, 'upstream/espeak-ng', name)),
  '-I' + path.join(referenceBuild, 'src/libespeak-ng/include'),
  generateCommandsSource,
  observedSynthesizeSource,
  observedWavegenSource,
  ...inputs.libraries.map(row => path.join(referenceBuild, row.path)),
  '-lm', '-o', generateCommandsBinary,
];
execFileSync(compiler, args, { timeout: 60000, stdio: 'inherit' });
assert.deepEqual(generateCommandsInputs(), inputs, 'Inputs changed while building generate-commands oracle');
writeFileSync(path.join(generateCommandsRoot, 'build-stamp.json'), JSON.stringify({
  schemaVersion: 1, inputs, compiler,
  compilerVersion: execFileSync(compiler, ['--version'], { encoding: 'utf8' }).split('\n')[0],
  compileArguments: args, binarySha256: fileHash(generateCommandsBinary),
  boundary: 'Original Generate wcmdq command plan',
}, null, 2) + '\n');
console.log('Built original Generate command oracle.');
