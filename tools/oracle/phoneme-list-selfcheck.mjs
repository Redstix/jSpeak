import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {root,referenceBuild,fileHash,sha256} from './trace-build-info.mjs';
import {createPhonemeListOracle} from './phoneme-list.mjs';
import {createPhonemeTables} from '../../src/core/phoneme-table.js';
import {createPhonemeListSession,PHONEME_LIST_PROFILE} from '../../src/core/phoneme-list.js';
export function typedListSnapshot(snapshot) {
  const list={length:snapshot.list.length};
  for(const name of ['phcode','stresslevel','wordstress','tonePh'])list[name]=Uint8Array.from(snapshot.list[name]);
  for(const name of ['sourceix','synthflags'])list[name]=Uint16Array.from(snapshot.list[name]);
  return{list,state:{...snapshot.state,embeddedList:Uint32Array.from(snapshot.state.embeddedList)}};
}
export function makePhonemeListCorpus(table) {
  const rows=[],add=(word,options={})=>rows.push({wordHex:Buffer.from(word).toString('hex'),wordLength:Math.min(255,Buffer.byteLength(word)),...options});
  for(const word of ['a','the','hello','world','cat','testing','happy','reading','reconstruction','queue','rhythm','walked','watches','judges','produce','record','resume',"can't","john's",'is','and','but','of','to','for','with','in','on','as','an','that','this','very','capable']) {
    add(word);
    for(const settings of [{prePause:3},{prePause:4,seed:1},{wordFlags:3,optionCapitals:1},{wordFlags:2,optionCapitals:3,embeddedIndex:242},{embeddedFlag:2},{wordFlags:128,prevDictFlags0:16384},{wordFlags:131072},{sourceIndex:65535,wordLength:255}])add(word,settings);
  }
  const mnemonics=[];
  for(const ph of table.entries)if(ph&&ph.code!==21&&ph.mnemonic){
    const bytes=[];for(let m=ph.mnemonic;m;m>>>=8)bytes.push(m&255);
    const word=Buffer.from(bytes);mnemonics.push(word.toString());
    for(const settings of [{},{seed:1},{wordFlags:8|128,embeddedFlag:2}])add(word,{wordFlags:8,...settings});
  }
  for(const count of [1,2,985,989,990])for(const prePause of [0,1,2,3,4,1999])for(const optionCapitals of [0,1,3]) {
    add("'a:b|'a||l=",{wordFlags:8|3|131072,count,prePause,optionCapitals,seed:1,embeddedFlag:2,prevDictFlags0:16384,prevDictFlags1:0x80000000,embeddedIndex:242});
  }
  for(const word of [' ',"'",':','=','||','_','_|_',"'a|'a",'a|b|a','b|b|a','_a']) {
    for(const settings of [{},{embeddedFlag:2},{wordFlags:8|128},{seed:1,wordFlags:8|131072}])add(word,{wordFlags:8,...settings});
  }
  let random=0x5eed0502;
  const next=()=>{random^=random<<13;random^=random>>>17;random^=random<<5;return random>>>0;};
  for(let i=0;i<256;i++) {
    const word=Array.from({length:1+next()%8},()=>mnemonics[next()%mnemonics.length]).join('|');
    add(word,{wordFlags:8,seed:next()%2,prePause:next()%6,sourceIndex:next()&65535,wordLength:next()&255,prevDictFlags0:next(),prevDictFlags1:next(),endStressedVowel:next()%2,anyStressedWords:Boolean(next()%2),embeddedFlag:next()%2?2:0});
  }
  for(const operation of [1,2,3])for(const count of [1,2,990,991,997,998,999,1000]) {
    if(operation===2&&count>998)continue;
    for(const seed of [0,1])for(const embeddedFlag of [0,2])add('',{operation,count,seed,embeddedFlag,prevDictFlags0:0xffffffff,prevDictFlags1:123,endStressedVowel:1,anyStressedWords:true,embeddedIndex:242});
  }
  for(const sourceIndex of [0,1,2047,65535,65536,0xffffffff])add('',{operation:2,seed:1,sourceIndex});
  return rows;
}
export function verifyPhonemeList({directory}={}) {
  const names=['src/core/phoneme-list.js','src/core/phoneme-table.js','src/core/unicode.js','data/phoneme-list/profile.js','data/phoneme-list/manifest.json','data/dictionary/profile.js','tools/oracle/phoneme-list.mjs','tools/oracle/phoneme-list-selfcheck.mjs'];
  const snapshot=()=>names.map(name=>({path:name,sha256:fileHash(path.join(root,name))}));
  const files=snapshot(),table=createPhonemeTables(readFileSync(path.join(referenceBuild,'espeak-ng-data/phontab'))).select(80),oracle=createPhonemeListOracle(),initial=oracle();
  const {constants,...profile}=initial.profile;assert.deepEqual(profile,PHONEME_LIST_PROFILE);
  const requests=makePhonemeListCorpus(table),requestBytes=JSON.stringify(requests,null,2)+'\n';
  if(!directory){mkdirSync(path.join(root,'artifacts'),{recursive:true});directory=mkdtempSync(path.join(root,'artifacts/phoneme-list-'));}mkdirSync(directory,{recursive:true});writeFileSync(path.join(directory,'requests.json'),requestBytes);
  let active=null;
  try{
    for(let offset=0;offset<requests.length;offset+=16){
      active={batchOffset:offset};const rows=requests.slice(offset,offset+16),reference=oracle(rows);assert.deepEqual(reference.reference,initial.reference);
      reference.results.forEach((result,index)=>{
        active={index:offset+index,request:rows[index]};
        if(result.operation){
          const session=createPhonemeListSession(table,profile,typedListSnapshot(result.before));
          if(result.operation===1)session.appendEmbeddedWordEnd();
          else if(result.operation===2)session.finishClause(rows[index].sourceIndex??1);
          else session.beginClause();
          assert.deepEqual(session.snapshot(),typedListSnapshot(result.after),`Original arena operation ${offset+index}`);return;
        }
        assert.equal(result.captured,1,'Original request must reach exactly one list boundary');
        assert.equal(result.options.switchPhonemes,-1,'Corpus must remain in original English table');
        const session=createPhonemeListSession(table,profile,typedListSnapshot(result.before));
        const actual=session.appendWord(Buffer.from(result.phonemesHex,'hex'),{...result.options,wordBytes:Buffer.from(result.wordHex,'hex')});
        assert.equal(actual.flags,result.flags,`Original list flags ${offset+index}`);
        assert.deepEqual(session.snapshot(),typedListSnapshot(result.after),`Original full list/state ${offset+index}`);
      });
    }
    assert.deepEqual(snapshot(),files,'Phoneme-list sources changed during verification');assert.deepEqual(createPhonemeListOracle()().reference,initial.reference);
  }catch(error){writeFileSync(path.join(directory,'failure.json'),JSON.stringify({schemaVersion:1,status:'failed',active,error:error.stack,reference:initial.reference,files},null,2)+'\n');error.message+='\nFailure artifact: '+path.join(directory,'failure.json');throw error;}
  const report={schemaVersion:1,status:'passed',scope:'Original TranslateWord2 post-translation list-building boundary and original empty/DELETE branch; clause start/end use verbatim blocks extracted from original source. Original C word translation/EncodePhonemes supply captured tail input, not a JS word2/phonemizer proof',cases:requests.length,builderCases:requests.filter(r=>!r.operation).length,arenaOperationCases:requests.filter(r=>r.operation).length,arenaRowsComparedPerSnapshot:1000,columns:6,embeddedSlotsCompared:250,requestsSha256:sha256(requestBytes),files,reference:initial.reference,profile,artifactDirectory:directory};
  writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){if(process.argv.length!==2)throw new Error('Usage: node tools/oracle/phoneme-list-selfcheck.mjs');console.log(JSON.stringify(verifyPhonemeList(),null,2));}
