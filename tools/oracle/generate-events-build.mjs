import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { root, referenceBuild, fileHash } from './trace-build-info.mjs';
import {
  generateEventsBinary, generateEventsInputs, generateEventsObserved,
  generateEventsRoot, generateEventsSource
} from './generate-events-build-info.mjs';

const inputs = generateEventsInputs();
mkdirSync(generateEventsRoot, { recursive: true });
const observedHeader = path.join(generateEventsRoot, 'synthesize-observed.h');
const originalHeader = readFileSync(path.join(root, 'upstream/espeak-ng/src/libespeak-ng/synthesize.h'), 'utf8');
const patchedHeader = originalHeader.replace('#define N_WCMDQ   170', '#define N_WCMDQ   4096');
assert.notEqual(patchedHeader, originalHeader, 'Unique N_WCMDQ header anchor');
writeFileSync(observedHeader, patchedHeader);
const original = readFileSync(path.join(root, 'upstream/espeak-ng/src/libespeak-ng/synthesize.c'), 'utf8');
const helper = `
static int jsge_envelope_index(const unsigned char *env) {
    if (env == NULL) return -1;
    for (int i = 0; i < N_ENVELOPE_DATA; i++) if (env == envelope_data[i]) return i;
    return -2;
}
`;
let observed = original.replace('#include "speech.h"               // for MAKE_MEM_UNDEFINED\n', '#include "speech.h"               // for MAKE_MEM_UNDEFINED\n' + helper);
const replacements = [
  ['static void StartSyllable(void)\n{', 'static void StartSyllable(void)\n{\n\tprintf("{\\"kind\\":\\"startSyllable\\"}\\n");'],
  ['static void EndPitch(int voice_break)\n{', 'static void EndPitch(int voice_break)\n{\n\tprintf("{\\"kind\\":\\"endPitch\\",\\"voiceBreak\\":%d}\\n", voice_break);'],
  ['static void DoAmplitude(int amp, const unsigned char *amp_env)\n{', 'static void DoAmplitude(int amp, const unsigned char *amp_env)\n{\n\tprintf("{\\"kind\\":\\"amplitude\\",\\"amp\\":%d,\\"envelope\\":%d}\\n", amp, jsge_envelope_index(amp_env));'],
  ['static void DoPitch(const unsigned char *env, int pitch1, int pitch2)\n{', 'static void DoPitch(const unsigned char *env, int pitch1, int pitch2)\n{\n\tprintf("{\\"kind\\":\\"pitch\\",\\"envelope\\":%d,\\"pitch1\\":%d,\\"pitch2\\":%d}\\n", jsge_envelope_index(env), pitch1, pitch2);'],
  ['static void DoPause(int length, int control)\n{', 'static void DoPause(int length, int control)\n{\n\tprintf("{\\"kind\\":\\"pause\\",\\"length\\":%d,\\"control\\":%d}\\n", length, control);'],
  ['int DoSample3(PHONEME_DATA *phdata, int length_mod, int amp)\n{', 'int DoSample3(PHONEME_DATA *phdata, int length_mod, int amp)\n{\n\tprintf("{\\"kind\\":\\"sample3\\",\\"soundAddr\\":%d,\\"soundParam\\":%d,\\"lengthMod\\":%d,\\"amp\\":%d,\\"control\\":%d,\\"lengthModParam\\":%d}\\n", phdata->sound_addr[pd_WAV], phdata->sound_param[pd_WAV], length_mod, amp, phdata->pd_control, phdata->pd_param[pd_LENGTHMOD]);'],
  ['int DoSpect2(PHONEME_TAB *this_ph, int which, FMT_PARAMS *fmt_params,  PHONEME_LIST *plist, int modulation)\n{', 'int DoSpect2(PHONEME_TAB *this_ph, int which, FMT_PARAMS *fmt_params,  PHONEME_LIST *plist, int modulation)\n{\n\tprintf("{\\"kind\\":\\"spect2\\",\\"code\\":%u,\\"type\\":%u,\\"which\\":%d,\\"modulation\\":%d,\\"fmtAddr\\":%d,\\"fmtAmp\\":%d,\\"wavAddr\\":%d,\\"wavAmp\\":%d,\\"stdLength\\":%d,\\"fmtControl\\":%d,\\"useVowelin\\":%d,\\"transition0\\":%d,\\"transition1\\":%d,\\"fmt2Addr\\":%d,\\"fmt2Lenadj\\":%d,\\"lengthMod\\":%u,\\"synthflags\\":%u}\\n", this_ph->code, this_ph->type, which, modulation, fmt_params->fmt_addr, fmt_params->fmt_amp, fmt_params->wav_addr, fmt_params->wav_amp, fmt_params->std_length, fmt_params->fmt_control, fmt_params->use_vowelin, fmt_params->transition0, fmt_params->transition1, fmt_params->fmt2_addr, fmt_params->fmt2_lenadj, plist->length, plist->synthflags);'],
  ['void DoMarker(int type, int char_posn, int length, int value)\n{', 'void DoMarker(int type, int char_posn, int length, int value)\n{\n\tprintf("{\\"kind\\":\\"marker\\",\\"type\\":%d,\\"charPosn\\":%d,\\"length\\":%d,\\"value\\":%d}\\n", type, char_posn, length, value);'],
  ['void DoEmbedded(int *embix, int sourceix)\n{', 'void DoEmbedded(int *embix, int sourceix)\n{\n\tprintf("{\\"kind\\":\\"embedded\\",\\"sourceix\\":%d,\\"index\\":%d}\\n", sourceix, *embix);'],
  ['int Generate(PHONEME_LIST *phoneme_list, int *n_ph, bool resume)\n{', 'int Generate(PHONEME_LIST *phoneme_list, int *n_ph, bool resume)\n{\n\tif (!resume) printf("{\\"kind\\":\\"generate.begin\\",\\"resume\\":%d,\\"count\\":%d}\\n", resume, *n_ph); else printf("{\\"kind\\":\\"generate.resume\\"}\\n");'],
  ['\t\tp = &phoneme_list[ix];\n', '\t\tp = &phoneme_list[ix];\n\t\tprintf("{\\"kind\\":\\"phoneme\\",\\"index\\":%d,\\"code\\":%u,\\"type\\":%u,\\"stress\\":%u,\\"synthflags\\":%u,\\"length\\":%u,\\"prepause\\":%u,\\"amp\\":%u,\\"pitch1\\":%u,\\"pitch2\\":%u,\\"env\\":%u,\\"newword\\":%u}\\n", ix, p->ph->code, p->type, p->stresslevel, p->synthflags, p->length, p->prepause, p->amp, p->pitch1, p->pitch2, p->env, p->newword);\n'],
  ['\tEndPitch(1);\n\tif (*n_ph > 0) {', '\tEndPitch(1);\n\tprintf("{\\"kind\\":\\"generate.end\\"}\\n");\n\tif (*n_ph > 0) {']
];
for (const [old, replacement] of replacements) {
  assert.equal(observed.split(old).length, 2, 'Unique Generate event anchor: ' + old);
  observed = observed.replace(old, replacement);
}
writeFileSync(generateEventsObserved, observed);

const compiler = readFileSync(path.join(referenceBuild, 'CMakeCache.txt'), 'utf8')
  .match(/^CMAKE_C_COMPILER:FILEPATH=(.+)$/m)?.[1];
assert(compiler, 'Missing C compiler from reference build');
const args = [
  '-std=gnu11', '-O2', '-Wall', '-Wextra', '-fwrapv', '-DLIBESPEAK_NG_EXPORT=1',
  '-include', observedHeader,
  '-I' + generateEventsRoot,
  ...['src/include', 'src/include/compat', 'src/ucd-tools/src/include', 'src/libespeak-ng']
    .map(name => '-I' + path.join(root, 'upstream/espeak-ng', name)),
  '-I' + path.join(referenceBuild, 'src/libespeak-ng/include'),
  generateEventsSource, generateEventsObserved,
  path.join(root, 'upstream/espeak-ng/src/libespeak-ng/wavegen.c'),
  ...inputs.libraries.map(row => path.join(referenceBuild, row.path)),
  '-lm', '-o', generateEventsBinary,
];
execFileSync(compiler, args, { timeout: 60000, stdio: 'inherit' });
assert.deepEqual(generateEventsInputs(), inputs, 'Inputs changed while building generate-events oracle');
writeFileSync(path.join(generateEventsRoot, 'build-stamp.json'), JSON.stringify({
  schemaVersion: 1, inputs, compiler,
  compilerVersion: execFileSync(compiler, ['--version'], { encoding: 'utf8' }).split('\n')[0],
  compileArguments: args, binarySha256: fileHash(generateEventsBinary),
  observedSourceSha256: fileHash(generateEventsObserved),
  boundary: 'Original Generate high-level synthesis event plan',
}, null, 2) + '\n');
console.log('Built original Generate event oracle.');
