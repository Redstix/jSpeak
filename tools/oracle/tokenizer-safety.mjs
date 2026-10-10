/* Reproduce original tokenizer undefined behavior without changing its source. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { root, referenceBuild, config, fileHash, validateReference } from './trace-build-info.mjs';

const reference = validateReference();
mkdirSync(path.join(root, 'artifacts'), { recursive: true });
const directory = mkdtempSync(path.join(root, 'artifacts/oracle-tokenizer-safety-'));
const source = path.join(root, 'upstream/espeak-ng');
const compiler = readFileSync(path.join(referenceBuild, 'CMakeCache.txt'), 'utf8').match(/^CMAKE_C_COMPILER:FILEPATH=(.+)$/m)?.[1];
if (!compiler) throw new Error('No reference C compiler');
const translate = path.join(source, 'src/libespeak-ng/translate.c');
const object = path.join(directory, 'translate-ubsan.o');
const binary = path.join(directory, 'espeak-ng-ubsan');
const flags = ['-O1', '-g', '-fwrapv', '-fsanitize=undefined,bounds', '-fno-sanitize-recover=all'];
const includes = ['src/include', 'src/include/compat', 'src/ucd-tools/src/include'].map(p => '-I' + path.join(source, p));
const compile = [...flags, '-DLIBESPEAK_NG_EXPORT=1', ...includes, '-I' + path.join(referenceBuild, 'src/libespeak-ng/include'), '-c', translate, '-o', object];
const link = [...flags, path.join(referenceBuild, 'src/CMakeFiles/espeak-ng-bin.dir/espeak-ng.c.o'), object,
  path.join(referenceBuild, 'src/libespeak-ng/libespeak-ng.a'), path.join(referenceBuild, 'src/ucd-tools/libucd.a'), '-lm', '-o', binary];
execFileSync(compiler, compile, { stdio: 'inherit' });
execFileSync(compiler, link, { stdio: 'inherit' });
const cases = [];
for (const entry of [
  { id: 'safe-prepause-expansion', text: 'a - ' + '한'.repeat(88), undefined: false },
  { id: 'overflow-prepause-expansion', text: 'ab - ' + '한'.repeat(88), undefined: true }
]) {
  const bytes = Buffer.from(entry.text);
  const args = ['-D', '-b', '1', '-v', 'en-us', '-s', '175', '-p', '50', '-a', '100', '--stdin', '-x', '-w', path.join(directory, entry.id + '.wav')];
  const result = spawnSync(binary, args, { input: bytes, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, ESPEAK_DATA_PATH: referenceBuild, LC_ALL: 'C', JSPEAK_TRACE_FILE: '', UBSAN_OPTIONS: 'print_stacktrace=1:halt_on_error=1' } });
  writeFileSync(path.join(directory, entry.id + '.stderr.txt'), result.stderr || '');
  writeFileSync(path.join(directory, entry.id + '.input.bin'), bytes);
  if (entry.undefined) {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /index 800 out of bounds for type 'char \[800\]'/);
  } else assert.equal(result.status, 0, result.stderr);
  cases.push({ id: entry.id, inputHex: bytes.toString('hex'), inputBytes: bytes.length, expectedUndefinedBehavior: entry.undefined,
    exitCode: result.status, diagnostic: result.stderr.trim(), stderr: entry.id + '.stderr.txt' });
}
const report = { schemaVersion: 1, kind: 'original-translate-c-ubsan-capacity-proof', upstreamCommit: config.commit,
  reference, sourceSha256: fileHash(translate), compiler, compilerVersion: execFileSync(compiler, ['--version'], { encoding: 'utf8' }).split('\n')[0],
  compile, link, coverage: 'Only original translate.c instrumented; remaining original CLI/library objects unchanged. Not a whole-program sanitizer audit.',
  cases, status: 'passed' };
writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`PASS: original tokenizer UBSAN distinguishes safe 268-byte input from undefined 269-byte input. Report: ${directory}/report.json`);
