import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { traceSource, traceBuild, referenceBuild, fileHash, validateTraceBuild } from './trace-build-info.mjs';
import { clauseSource, clauseRoot, clauseBinary, clauseReferenceBinary, clauseInputs } from './clause-build-info.mjs';
const trace = validateTraceBuild();
mkdirSync(clauseRoot, { recursive: true });
const compiler = readFileSync(path.join(traceBuild, 'CMakeCache.txt'), 'utf8').match(/^CMAKE_C_COMPILER:FILEPATH=(.+)$/m)?.[1];
if (!compiler) throw new Error('No configured C compiler');
const args = ['-std=c11', '-O2', '-Wall', '-Wextra', '-fwrapv', '-DLIBESPEAK_NG_EXPORT=1',
  ...['src/include', 'src/include/compat', 'src/ucd-tools/src/include', 'src/libespeak-ng'].map(name => '-I' + path.join(traceSource, name)),
  '-I' + path.join(traceBuild, 'src/libespeak-ng/include'), clauseSource];
for (const [build, output] of [[traceBuild, clauseBinary], [referenceBuild, clauseReferenceBinary]]) {
  execFileSync(compiler, [...args, path.join(build, 'src/libespeak-ng/libespeak-ng.a'), path.join(build, 'src/ucd-tools/libucd.a'), '-lm', '-o', output], { stdio: 'inherit' });
}
writeFileSync(path.join(clauseRoot, 'build-stamp.json'), JSON.stringify({ schemaVersion: 1, traceFingerprint: trace.fingerprint, inputs: clauseInputs(), compiler,
  compilerVersion: execFileSync(compiler, ['--version'], { encoding: 'utf8' }).split('\n')[0], compileArguments: args,
  binarySha256: fileHash(clauseBinary), referenceBinarySha256: fileHash(clauseReferenceBinary)
}, null, 2) + '\n');
console.log('Built independent clean/instrumented ReadClause and UCD property helpers.');
