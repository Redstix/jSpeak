import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root, referenceBuild, sha256 } from './trace-build-info.mjs';
import { clauseWord2Binary, validateClauseWord2Build } from './clause-word2-build-info.mjs';
import { makeTraceCorpus } from './trace-corpus.mjs';
const args=process.argv.slice(2);if(args.length&&!(args.length===2&&args[0]==='--trace-dir'))throw new Error('Usage: node tools/oracle/clause-word2-selfcheck.mjs [--trace-dir FROZEN_TRACE_DIRECTORY]');
const frozen=args.length?path.resolve(args[1]):null,build=validateClauseWord2Build();
mkdirSync(path.join(root,'artifacts'),{recursive:true});const out=mkdtempSync(path.join(root,'artifacts/oracle-clause-word2-'));
const extra=['Hello 123456 world. Again!', '1000001 123456789 0123456', '123456 st 1000000 th', 'foo bar baz', 'abc αβγδ абвг',
  '\x0118YAb12','\x0166Y1234567','\x0136Ykey','\x012Bword','\x010Bword','\x013Fword','\x014Fword',
  '\x01100PHello WORLD.', 'First! Second? Third.','[[h@loU]].','你好 😀 é ɒ','a\u0301 x','boogey hello'].map((text,i)=>({id:'word2-extra-'+i,bytes:Buffer.from(text)}));
const corpus=[...makeTraceCorpus(),...extra],captures=[],origins={},bridges=[];let active=null,calls=0,clauses=0;
try{
 for(const entry of corpus){
  active={id:entry.id,utf8Hex:entry.bytes.toString('hex')};const directory=path.join(out,entry.id);mkdirSync(directory);
  function cli(label){const observed=label!=='reference',wav=path.join(directory,label+'.wav'),trace=path.join(directory,label+'.jsonl');
    const mnemonic=execFileSync(observed?clauseWord2Binary:path.join(referenceBuild,'src/espeak-ng'),['-D','-b','1','-v','en-us','-s','175','-p','50','-a','100','--stdin','-x','-w',wav],{
      input:entry.bytes,encoding:'utf8',timeout:30000,maxBuffer:32*1024*1024,env:{...process.env,ESPEAK_DATA_PATH:referenceBuild,JSPEAK_TRACE_FILE:'',JSPEAK_WORD_TRACE_FILE:'',JSPEAK_CLAUSE_WORD2_TRACE_FILE:observed?trace:'',LC_ALL:'C'}});
    return {mnemonic,wavSha256:existsSync(wav)?sha256(readFileSync(wav)):null,events:existsSync(trace)?readFileSync(trace,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[]};
  }
  const reference=cli('reference'),observed=cli('observed'),repeat=cli('repeat');
  assert.deepEqual({mnemonic:observed.mnemonic,wavSha256:observed.wavSha256},{mnemonic:reference.mnemonic,wavSha256:reference.wavSha256},entry.id+': observer changes original CLI');
  assert.deepEqual(repeat,observed,entry.id+': repeated full CLI observation differs');
  let previous=null,currentClause=null,pending=null;const words=[],final=[];
  for(const event of observed.events){
    assert.equal(event.schemaVersion,1);assert.equal(event.phonemeList2.items.length,event.phonemeList2.count);
    assert(event.phonemeList2.count<=event.phonemeList2.capacity);
    assert.equal(event.embedded.index,event.embedded.list.length);assert(event.embedded.read<=event.embedded.index);
    if(event.kind==='clause.words'){
      assert.equal(currentClause,null);assert.equal(pending,null);currentClause=event.clause;clauses++;words.push(event);
      assert.equal(event.wordsWithSentinel.length,event.wordCount+1);assert.equal(event.phonemeList2.count,1);
      assert.deepEqual(event.phonemeList2.items[0],{synthflags:0,phcode:10,stresslevel:0,sourceix:0,wordstress:0,tonePh:0});
      assert.equal(event.bufferHex.slice(0,6),'002020');assert.equal(event.bufferHex.slice(-2),'00');
      assert.equal(event.clauseState.clauseEndOffset,event.bufferHex.length/2-2);previous=event.phonemeList2;
    }else if(event.kind==='word2.enter'){
      assert.equal(pending,null);assert.equal(event.clause,currentClause);pending=event;calls++;origins[event.origin]=(origins[event.origin]||0)+1;
      assert.equal(event.words.length,event.remaining);assert(event.offset>=3&&event.offset<event.bufferHex.length/2);
      assert.deepEqual(event.phonemeList2,previous,entry.id+': clause loop unexpectedly alters active phoneme list before Word2');
    }else if(event.kind==='word2.exit'){
      assert(pending);assert.equal(event.id,pending.id);assert.equal(event.clause,currentClause);assert.equal(event.origin,pending.origin);
      previous=event.phonemeList2;pending=null;
    }else if(event.kind==='clause.before-phonemelist'){
      assert.equal(event.clause,currentClause);assert.equal(pending,null);assert.equal(event.wordsWithSentinel.length,event.wordCount+1);
      assert.equal(event.phonemeList2.count,previous.count+2);
      assert.deepEqual(event.phonemeList2.items.slice(0,-2),previous.items);
      for(const row of event.phonemeList2.items.slice(-2))assert.deepEqual({phcode:row.phcode,stresslevel:row.stresslevel,sourceix:row.sourceix,synthflags:row.synthflags},{phcode:9,stresslevel:0,sourceix:event.sourceIndex,synthflags:0});
      final.push(event);currentClause=null;previous=null;
    }else throw new Error('Unknown observer event '+event.kind);
  }
  assert.equal(currentClause,null);assert.equal(pending,null);
  if(frozen&&existsSync(path.join(frozen,entry.id,'trace.json'))){
    const trace=JSON.parse(readFileSync(path.join(frozen,entry.id,'trace.json'))),oldWords=trace.events.filter(e=>e.kind==='words'),oldFinal=trace.events.filter(e=>e.kind==='phonemes-before-list');
    assert.equal(words.length,oldWords.length);assert.equal(final.length,oldFinal.length);
    for(let i=0;i<words.length;i++)assert.deepEqual({bufferHex:words[i].bufferHex.slice(0,-2),items:words[i].wordsWithSentinel.slice(0,words[i].wordCount)}, {bufferHex:oldWords[i].bufferHex,items:oldWords[i].items});
    for(let i=0;i<final.length;i++){
      const e=final[i];let table=e.wordState.phonemeTable;
      const projected={initialTable:table,postPauseMs:e.clausePause,startSentence:e.newSentence2,items:e.phonemeList2.items.map(p=>{const switchTo=p.phcode===21?p.tonePh:-1,row={table,code:p.phcode,stress:p.stresslevel,sourceix:p.sourceix,synthflags:p.synthflags,switchTo};if(switchTo>=0)table=switchTo;return row;})};
      const {seq,kind,...wanted}=oldFinal[i];assert.deepEqual(projected,wanted,entry.id+': frozen pre-MakePhonemeList bridge differs');
    }
    bridges.push({id:entry.id,clauses:final.length});
  }
  captures.push({...active,mnemonic:observed.mnemonic,wavSha256:observed.wavSha256,events:observed.events.length,clauses:final.length});
 }
 assert.deepEqual(validateClauseWord2Build(),build);
 const report={schemaVersion:1,kind:'original-clause-word2-readonly-cli-observer-selfcheck',status:'passed',fingerprint:build.fingerprint,
  cliTransparencyCases:captures.length,cliTransparencyOutputs:'exact mnemonic and complete WAV bytes',freshCliRunsPerObservation:2,clauses,word2Calls:calls,origins,
  frozenBridge:{directory:frozen,cases:bridges.length,clauses:bridges.reduce((sum,row)=>sum+row.clauses,0)},captures,
  fieldSemantics:['wordstress raw storage is not assigned for most Word2 entries; it is not a semantic equality field at this boundary.',
    'The final two pause entries do not initialize tone_ph; compare their code/stress/sourceix/synthflags only.',
    'This is a full original CLI observer, not a proof of complete JS Word2 or phonemizer integration.']};
 writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(`PASS ${captures.length} exact CLI cases, ${clauses} clauses, ${calls} Word2 calls, ${bridges.length} frozen bridges; ${out}/report.json`);
}catch(error){writeFileSync(path.join(out,'failure.json'),JSON.stringify({active,error:error.stack},null,2)+'\n');throw error;}
