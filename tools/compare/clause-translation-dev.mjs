import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
import { root, traceBuild, validateTraceBuild } from '../oracle/trace-build-info.mjs';
import { loadDictionary } from '../../src/core/dictionary.js';
import { createPhonemeTables } from '../../src/core/phoneme-table.js';
import { createEnglishClauseTranslation } from '../../src/core/translate-clause.js';
validateTraceBuild();
const dictionary=loadDictionary(new Uint8Array(readFileSync(path.join(root,'data/dictionary/en_dict.bin'))), JSON.parse(readFileSync(path.join(root,'data/dictionary/manifest.json'))));
const table=createPhonemeTables(new Uint8Array(readFileSync(path.join(root,'build/oracle/espeak-ng-data/phontab')))).select(80);
const output=mkdtempSync(path.join(root,'artifacts/clause-translation-development-'));
const corpus=['Hello world.', 'The quick brown fox jumps over the lazy dog.', 'one, two; three!', 'a + b', 'Hello. Good morning.', '1234', '\x01'+'3FHello','Read the book.', 'I read it yesterday. We will read it again.', 'Mr. Smith lives here.', 'The U.S.A. is a country.', 'I have 23 books.', 'The water is cold.', 'It costs $12.50.', 'a,b,c','{hello} (world)', 'NASA IBM ABC', '\x01'+'18Yhello world','\x01'+'3Bhello','[[]]','[[h@l\'oU]]'];
let exact=0,errors=[];
for(const [index,text] of corpus.entries()) {
  const file=path.join(output,index+'.jsonl');
  execFileSync(path.join(traceBuild,'src/espeak-ng'),['-D','-b','1','-v','en-us','-s','175','-p','50','-a','100','--stdin','-x','-w',path.join(output,index+'.wav')],{input:Buffer.from(text),env:{...process.env,ESPEAK_DATA_PATH:traceBuild,LC_ALL:'C',JSPEAK_TRACE_FILE:file}});
  const expected=readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse).filter(r=>r.kind==='phonemes-before-list');
  const session=createEnglishClauseTranslation(new Uint8Array(Buffer.from(text)),dictionary,table),actual=[];
  try {
    while(session.hasMore()) {const r=session.next(),p=r.phonemes.list;actual.push({initialTable:80,postPauseMs:r.clausePause,startSentence:r.startSentence,items:Array.from({length:p.length},(_,i)=>({table:80,code:p.phcode[i],stress:p.stresslevel[i],sourceix:p.sourceix[i],synthflags:p.synthflags[i],switchTo:p.phcode[i]===21?p.tonePh[i]:-1}))});}
    assert.deepEqual(actual,expected.map(({initialTable,postPauseMs,startSentence,items})=>({initialTable,postPauseMs,startSentence,items})));exact++;
  } catch(error) { errors.push({index,text,code:error.code,message:error.message});writeFileSync(path.join(output,index+'-failure.json'),JSON.stringify({text,actual,expected,error:error.stack},null,2)); }
}
writeFileSync(path.join(output,'report.json'),JSON.stringify({status:'development-only',total:corpus.length,exact,errors},null,2));
console.log(JSON.stringify({output,total:corpus.length,exact,errors:errors.map(e=>({index:e.index,text:e.text,code:e.code,message:e.message.slice(0,180)}))},null,2));
