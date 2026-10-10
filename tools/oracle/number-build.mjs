import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { root, referenceBuild, fileHash } from './trace-build-info.mjs';
import { numberRoot, numberSource, numberBinary, numberCleanBinary, numberInputs } from './number-build-info.mjs';
const inputs = numberInputs();
const compiler = readFileSync(path.join(referenceBuild, 'CMakeCache.txt'), 'utf8').match(/^CMAKE_C_COMPILER:FILEPATH=(.+)$/m)?.[1]; assert(compiler);
mkdirSync(numberRoot, { recursive: true });
const args = ['-std=c11', '-O2', '-Wall', '-Wextra', '-fwrapv', '-DLIBESPEAK_NG_EXPORT=1',
  ...['src/include', 'src/include/compat', 'src/ucd-tools/src/include', 'src/libespeak-ng'].map(name => '-I' + path.join(root, 'upstream/espeak-ng', name)),
  '-I' + path.join(referenceBuild, 'src/libespeak-ng/include'), numberSource,
  ...inputs.libraries.map(entry => path.join(referenceBuild, entry.path)), '-lm', '-o', numberBinary];
execFileSync(compiler, args, { timeout: 60000, stdio: 'inherit' }); const cleanArgs = [...args]; cleanArgs.splice(0, 0, '-DJSPEAK_NUMBER_CLEAN=1'); cleanArgs[cleanArgs.length - 1] = numberCleanBinary;
execFileSync(compiler, cleanArgs, { timeout: 60000, stdio: 'inherit' }); assert.deepEqual(numberInputs(), inputs);
writeFileSync(path.join(numberRoot, 'build-stamp.json'), JSON.stringify({ schemaVersion: 1, inputs, compiler,
  compilerVersion: execFileSync(compiler, ['--version'], { encoding: 'utf8' }).split('\n')[0], compileArguments: args, cleanCompileArguments: cleanArgs, cleanBinarySha256: fileHash(numberCleanBinary), binarySha256: fileHash(numberBinary) }, null, 2) + '\n');
console.log('Built clean original TranslateNumber/TranslateRoman oracle.');
