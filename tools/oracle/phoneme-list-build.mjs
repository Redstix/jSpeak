import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {root,referenceBuild,fileHash} from './trace-build-info.mjs';
import {phonemeListRoot,phonemeListSource,phonemeListObserved,phonemeListBinary,phonemeListInputs} from './phoneme-list-build-info.mjs';
const inputs=phonemeListInputs(),original=readFileSync(path.join(root,'upstream/espeak-ng/src/libespeak-ng/translate.c'),'utf8');
const anchor='\tstress = 0;\n\tnext_stress = 1;\n\tsrcix = 0;';
assert.equal(original.split(anchor).length,2,'Unique original TranslateWord2 boundary');
function block(start,end){assert.equal(original.split(start).length,2);const position=original.indexOf(start),finish=original.indexOf(end,position);assert(finish>=position);return original.slice(position,finish+end.length);}
const finishBlock=block('\tfor (ix = 0; ix < 2; ix++) {\n\t\t// terminate the clause with 2 PAUSE phonemes','\tn_ph_list2 += 2;');
const beginBlock=block('\tMAKE_MEM_UNDEFINED(&ph_list2, sizeof(ph_list2));','\ttr->prev_dict_flags[1] = 0;');
const observed=original.replace(anchor,'\tm05_capture(tr, word, wtab, pre_pause, flags, switch_phonemes, pitch_raised, word_flags);\n'+anchor)+
  '\nstatic void m05_finish_clause(unsigned int source_index) { int ix;\n'+finishBlock+'\n}\n'+
  '\nstatic void m05_begin_clause(Translator *tr) {\n'+beginBlock+'\n}\n';
mkdirSync(phonemeListRoot,{recursive:true});writeFileSync(phonemeListObserved,observed);
const compiler=readFileSync(path.join(referenceBuild,'CMakeCache.txt'),'utf8').match(/^CMAKE_C_COMPILER:FILEPATH=(.+)$/m)?.[1];assert(compiler);
const args=['-std=c11','-O2','-Wall','-Wextra','-fwrapv','-DLIBESPEAK_NG_EXPORT=1','-DJSPEAK_M05_SOURCE='+JSON.stringify(phonemeListObserved),
  ...['src/include','src/include/compat','src/ucd-tools/src/include','src/libespeak-ng'].map(name=>'-I'+path.join(root,'upstream/espeak-ng',name)),
  '-I'+path.join(referenceBuild,'src/libespeak-ng/include'),phonemeListSource,...inputs.libraries.map(row=>path.join(referenceBuild,row.path)),'-lm','-o',phonemeListBinary];
execFileSync(compiler,args,{timeout:60000,stdio:'inherit'});assert.deepEqual(phonemeListInputs(),inputs);
writeFileSync(path.join(phonemeListRoot,'build-stamp.json'),JSON.stringify({schemaVersion:1,inputs,compiler,compilerVersion:execFileSync(compiler,['--version'],{encoding:'utf8'}).split('\n')[0],compileArguments:args,binarySha256:fileHash(phonemeListBinary),observedSourceSha256:fileHash(phonemeListObserved),boundary:'Observation-only call immediately before stress=0 in original TranslateWord2'},null,2)+'\n');
console.log('Built original TranslateWord2 list-boundary observer.');
