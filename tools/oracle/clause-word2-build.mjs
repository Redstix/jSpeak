import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { root, referenceBuild, fileHash, sha256 } from './trace-build-info.mjs';
import { clauseWord2Root, clauseWord2Binary, clauseWord2Inputs } from './clause-word2-build-info.mjs';
const inputs=clauseWord2Inputs();mkdirSync(clauseWord2Root,{recursive:true});
let source=readFileSync(path.join(root,'upstream/espeak-ng/src/libespeak-ng/translate.c'),'utf8');
const replace=(from,to)=>{assert.equal(source.split(from).length-1,1,'Ambiguous instrumentation anchor');source=source.replace(from,to);};
replace('static int TranslateWord2(Translator *tr, char *word, WORD_TAB *wtab, int wtab_remaining, int pre_pause)\n{',
  '#include "clause-word2-observer.h"\n\nstatic int js_original_TranslateWord2(Translator *tr, char *word, WORD_TAB *wtab, int wtab_remaining, int pre_pause)\n{');
replace('\t// Each TranslateWord2 may require up to 7 phonemes',
  '\tjs_cw2_clause_words(tr, sbuf, (size_t)(tr->clause_end-sbuf)+2, words, word_count, source_index, clause_pause, tone_out ? *tone_out : tone, new_sentence2, terminator, charix, charix_top);\n\n\t// Each TranslateWord2 may require up to 7 phonemes');
replace('\t\t\t\tdict_flags = TranslateWord2(tr, pw, &num_wtab[nw], num_wtab_count - nw, words[ix].pre_pause);',
  '\t\t\t\tjs_cw2_context("number-split", number_buf, (size_t)(pn-number_buf)+17, ix, nw);\n\t\t\t\tdict_flags = TranslateWord2(tr, pw, &num_wtab[nw], num_wtab_count - nw, words[ix].pre_pause);');
replace('\t\t\tdict_flags = TranslateWord2(tr, word, &words[ix], word_count - ix, words[ix].pre_pause);',
  '\t\t\tjs_cw2_context("clause", sbuf, js_cw2_clause_size, ix, 0);\n\t\t\tdict_flags = TranslateWord2(tr, word, &words[ix], word_count - ix, words[ix].pre_pause);');
replace('\t\t\t\t\tTranslateWord2(tr, &number_buf[3], &words[ix], word_count - ix, 0);',
  '\t\t\t\t\tjs_cw2_context("spell-retry", number_buf, sizeof(number_buf), ix, (int)(pw-word));\n\t\t\t\t\tTranslateWord2(tr, &number_buf[3], &words[ix], word_count - ix, 0);');
replace('\tMakePhonemeList(tr, clause_pause, new_sentence2);',
  '\tjs_cw2_clause_final(tr, words, word_count, source_index, clause_pause, tone_out ? *tone_out : tone, new_sentence2, terminator);\n\tMakePhonemeList(tr, clause_pause, new_sentence2);');
const translate=path.join(clauseWord2Root,'translate-observed.c'),synthdata=path.join(clauseWord2Root,'synthdata-observed.c');
writeFileSync(translate,source);
writeFileSync(synthdata,readFileSync(path.join(root,'upstream/espeak-ng/src/libespeak-ng/synthdata.c'),'utf8')+'\nint jspeak_observed_phoneme_table(void) { return current_phoneme_table; }\n');
const compiler=readFileSync(path.join(referenceBuild,'CMakeCache.txt'),'utf8').match(/^CMAKE_C_COMPILER:FILEPATH=(.+)$/m)?.[1];assert(compiler);
const flags=['-std=c11','-O2','-Wall','-Wextra','-fwrapv','-DLIBESPEAK_NG_EXPORT=1',
  ...['src/include','src/include/compat','src/ucd-tools/src/include','src/libespeak-ng'].map(name=>'-I'+path.join(root,'upstream/espeak-ng',name)),
  '-I'+path.join(referenceBuild,'src/libespeak-ng/include'),'-I'+path.join(root,'tools/oracle')];
const commands=[],objects=[];
for(const file of [translate,synthdata]){const object=file+'.o',args=[...flags,'-c',file,'-o',object];execFileSync(compiler,args,{stdio:'inherit',timeout:60000});commands.push(args);objects.push(object);}
const link=[path.join(referenceBuild,'src/CMakeFiles/espeak-ng-bin.dir/espeak-ng.c.o'),...objects,path.join(referenceBuild,'src/libespeak-ng/libespeak-ng.a'),path.join(referenceBuild,'src/ucd-tools/libucd.a'),'-lm','-o',clauseWord2Binary];
execFileSync(compiler,link,{stdio:'inherit',timeout:60000});assert.deepEqual(clauseWord2Inputs(),inputs);
const stamp={schemaVersion:1,kind:'original-clause-word2-readonly-observer',inputs,compiler,compilerVersion:execFileSync(compiler,['--version'],{encoding:'utf8'}).split('\n')[0],commands,link,
  outputs:[translate,synthdata,...objects,clauseWord2Binary].map(file=>({path:path.relative(clauseWord2Root,file),sha256:fileHash(file)}))};
writeFileSync(path.join(clauseWord2Root,'build-stamp.json'),JSON.stringify(stamp,null,2)+'\n');console.log('Built independent clause/Word2 observer: '+sha256(JSON.stringify(stamp)));
