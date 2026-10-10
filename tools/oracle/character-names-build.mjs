import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { traceSource, referenceBuild, traceBuild, fileHash, validateTraceBuild } from './trace-build-info.mjs';
import { referenceSource, characterNamesRoot, characterNamesSource, characterNamesBinary, characterNamesReferenceBinary, characterNamesInputs } from './character-names-build-info.mjs';
const trace = validateTraceBuild();mkdirSync(characterNamesRoot, { recursive: true });
const compiler = readFileSync(path.join(traceBuild, 'CMakeCache.txt'), 'utf8').match(/^CMAKE_C_COMPILER:FILEPATH=(.+)$/m)?.[1];
if (!compiler) throw new Error('Missing C compiler');
const commands = [];
for (const [source, build, binary] of [[traceSource, traceBuild, characterNamesBinary], [referenceSource, referenceBuild, characterNamesReferenceBinary]]) {
  const wrapper = binary + '.c';
  writeFileSync(wrapper, '#include <espeak-ng/espeak_ng.h>\n#include ' + JSON.stringify(path.join(source, 'src/libespeak-ng/readclause.c')) + '\n#include ' + JSON.stringify(characterNamesSource) + '\n');
  const args = ['-std=c11', '-O2', '-Wall', '-Wextra', '-fwrapv', '-DLIBESPEAK_NG_EXPORT=1',
    ...['src/include', 'src/include/compat', 'src/ucd-tools/src/include', 'src/libespeak-ng'].map(name => '-I' + path.join(source, name)),
    '-I' + path.join(build, 'src/libespeak-ng/include'), wrapper, path.join(build, 'src/libespeak-ng/libespeak-ng.a'), path.join(build, 'src/ucd-tools/libucd.a'), '-lm', '-o', binary];
  commands.push(args);execFileSync(compiler, args, { stdio: 'inherit' });
}
writeFileSync(path.join(characterNamesRoot, 'build-stamp.json'), JSON.stringify({ schemaVersion: 1, traceFingerprint: trace.fingerprint, inputs: characterNamesInputs(), compiler, commands,
  compilerVersion: execFileSync(compiler, ['--version'], { encoding: 'utf8' }).split('\n')[0], binarySha256: fileHash(characterNamesBinary), referenceBinarySha256: fileHash(characterNamesReferenceBinary) }, null, 2) + '\n');
console.log('Built original static LookupCharName helpers.');
