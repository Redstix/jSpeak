import assert from 'node:assert/strict';import {readFileSync,mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';import {pathToFileURL} from 'node:url';import path from 'node:path';
import {root,referenceBuild,fileHash,sha256} from './trace-build-info.mjs';import {createPhonemePrepareOracle} from './phoneme-prepare.mjs';
import {createPhonemeTables} from '../../src/core/phoneme-table.js';import {preparePhonemeList,PHONEME_PREPARE_PROFILE} from '../../src/core/phoneme-list-prepare.js';
const byteColumns=['phcode','stresslevel','wordstress','tonePh'],shortColumns=['sourceix','synthflags'];
export function prepareFixture({codes=[],stress=[],source=[],flags=[],tones=[],seed=0,endSource=99}){
  const list={length:codes.length+3};assert(list.length<=1000);
  for(const name of byteColumns)list[name]=new Uint8Array(1000);
  for(const name of shortColumns)list[name]=new Uint16Array(1000);
  if(seed)for(let i=0;i<1000;i++){list.phcode[i]=10;list.wordstress[i]=i&255;list.tonePh[i]=17;list.sourceix[i]=i;list.synthflags[i]=0x1200;list.stresslevel[i]=19;}
  list.phcode[0]=10;list.stresslevel[0]=0;list.sourceix[0]=0;list.synthflags[0]=0;
  codes.forEach((code,i)=>{list.phcode[i+1]=code;list.stresslevel[i+1]=stress[i]??1;list.sourceix[i+1]=source[i]??(i===0?2049:0);list.synthflags[i+1]=flags[i]??0;list.tonePh[i+1]=tones[i]??0;});
  for(let i=list.length-2;i<list.length;i++){list.phcode[i]=9;list.stresslevel[i]=0;list.sourceix[i]=endSource;list.synthflags[i]=0;}
  return list;
}
export function makePhonemePrepareCorpus(){
  const rows=[],add=(codes,settings={})=>rows.push({codes,...settings});
  for(let code=0;code<256;code++)for(const level of [0,3,4,127,128,255]){
    add([code,55],{stress:[level,1],tones:code===21?[80,0]:[],source:[2049,0],seed:1});
    add([code],{stress:[level],tones:code===21?[80]:[]});
  }
  for(const codes of [[35,55,35],[35,55,55],[35,55,35,55],[35,35,35],[21,35],[21,21,126],[21,9,21,113],[0,126],[255,113],[0,0,35]]){
    for(const stress of [[1,1,1,1],[2,1,1,1],[4,1,1,1],[129,1,1,1]])for(const flag of [0,32,64]){
      add(codes,{stress,flags:codes.map((_,i)=>i===0?flag:0),tones:codes.map(c=>c===21?80:0),source:codes.map((_,i)=>i%2?4098:2049),seed:1});
    }
  }
  add([21,21,35],{tones:[1,80,0],source:[123,456,789]});
  add([21,9,21,35],{tones:[1,0,80,0],source:[123,456,789,0]});
  add([21,126],{tones:[80,0],flags:[2,0]});
  for(const length of [0,1,2,996,997])for(const code of [0,1,113,126,255])add(new Array(length).fill(code),{seed:1});
  let random=0x5eed0503;const next=()=>{random^=random<<13;random^=random>>>17;random^=random<<5;return random>>>0;};
  for(let i=0;i<512;i++){
    const length=next()%40,codes=Array.from({length},()=>{const b=next()&255;return b===21?126:b;});
    add(codes,{stress:codes.map(()=>next()&255),source:codes.map(()=>next()%3?0:next()&65535),flags:codes.map(()=>next()&0x70),seed:next()%2,endSource:next()&65535});
  }
  return rows;
}
function plain(result){return{...result,list2:{length:result.list2.length,...Object.fromEntries(byteColumns.concat(shortColumns).map(name=>[name,Array.from(result.list2[name])]))},working:{count:result.working.count,...Object.fromEntries(byteColumns.concat(shortColumns,['type','phonemeId']).map(name=>[name,Array.from(result.working[name].subarray(0,result.working.count))]))}};}
export function verifyPhonemePrepare({directory}={}){
  const names=['src/core/phoneme-list-prepare.js','src/core/phoneme-table.js','data/phoneme-prepare/profile.js','data/phoneme-prepare/manifest.json','tools/oracle/phoneme-prepare.mjs','tools/oracle/phoneme-prepare-selfcheck.mjs'];
  const snapshot=()=>names.map(name=>({path:name,sha256:fileHash(path.join(root,name))}));const files=snapshot();
  const table=createPhonemeTables(readFileSync(path.join(referenceBuild,'espeak-ng-data/phontab'))).select(80),oracle=createPhonemePrepareOracle(),initial=oracle();
  const {replacements,constants,...profile}=initial.profile;assert.deepEqual(profile,PHONEME_PREPARE_PROFILE);
  const requests=makePhonemePrepareCorpus(),bytes=JSON.stringify(requests,null,2)+'\n';
  if(!directory){mkdirSync(path.join(root,'artifacts'),{recursive:true});directory=mkdtempSync(path.join(root,'artifacts/phoneme-prepare-'));}mkdirSync(directory,{recursive:true});writeFileSync(path.join(directory,'requests.json'),bytes);
  let active=null;
  try{
    for(let offset=0;offset<requests.length;offset+=32){
      active={batchOffset:offset};const rows=requests.slice(offset,offset+32),lists=rows.map(prepareFixture),reference=oracle(lists.map(list=>({list})));assert.deepEqual(reference.reference,initial.reference);
      rows.forEach((row,index)=>{active={index:offset+index,request:row};assert.deepEqual(plain(preparePhonemeList(lists[index],table,profile)),reference.results[index],`Original MakePhonemeList pre-VM ${offset+index}`);});
    }
    assert.deepEqual(snapshot(),files);assert.deepEqual(createPhonemePrepareOracle()().reference,initial.reference);
  }catch(error){writeFileSync(path.join(directory,'failure.json'),JSON.stringify({schemaVersion:1,status:'failed',active,error:error.stack,files,reference:initial.reference},null,2)+'\n');throw error;}
  const report={schemaVersion:1,status:'passed',scope:'Original MakePhonemeList before first InterpretPhoneme: promotion, redundant-switch deletion, real voice substitution, invalid-code deletion, source markers and wordstress. No VM or final phoneme_list equivalence claimed.',cases:requests.length,requestsSha256:sha256(bytes),files,reference:initial.reference,profile,replacements,artifactDirectory:directory};writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){if(process.argv.length!==2)throw new Error('Usage: node tools/oracle/phoneme-prepare-selfcheck.mjs');console.log(JSON.stringify(verifyPhonemePrepare(),null,2));}
