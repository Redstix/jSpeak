import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {root,referenceBuild,fileHash,sha256} from '../oracle/trace-build-info.mjs';
import {createPhonemeInterpreterOracle,normalizeInterpreterRequest,interpreterRowFields} from '../oracle/phoneme-interpreter.mjs';
import {createPhonemeTables} from '../../src/core/phoneme-table.js';
import {createPhonemeInterpreter,createPhonemeListBuffer,createWordPhonemeData} from '../../src/core/phoneme-interpreter.js';
import {interpreterCorpus} from './phoneme-interpreter-corpus.mjs';
export function runInterpreterJS(input,tables,bytes){
  const row=normalizeInterpreterRequest(input);let selected=tables.select(row.table),program=bytes;
  if(row.program){program=new Uint8Array(row.program.length*2);const view=new DataView(program.buffer);row.program.forEach((v,i)=>view.setUint16(i*2,v,true));const entries=[...selected.entries],code=row.list[row.index].phonemeId-1;entries[code]={...entries[code],program:1};selected={...selected,entries};}
  const list=createPhonemeListBuffer(row.list.length),wordData=row.wordData?createWordPhonemeData():null;
  row.list.forEach((item,i)=>{for(const key of interpreterRowFields)list[key][i]=item[key];});
  if(wordData)for(const key of interpreterRowFields)wordData.prevVowel[key][0]=row.prevVowel[key];
  const data=createPhonemeInterpreter(program,selected).interpret(list,row.index,{start:row.start,control:row.control,translator:row.translator,reduce:row.reduce,klatt:row.klatt,wordData});
  const outData=Object.fromEntries(Object.entries(data).map(([key,value])=>[key,ArrayBuffer.isView(value)?Array.from(value):value]));
  const item=(buffer,i)=>Object.fromEntries(interpreterRowFields.map(key=>[key,buffer[key][i]]));
  return {data:outData,list:row.list.map((_,i)=>item(list,i)),prevVowel:wordData?item(wordData.prevVowel,0):null};
}
export function verifyPhonemeInterpreter({corpus=null}={}){
  const names=['src/core/phoneme-interpreter.js','src/core/phoneme-table.js','tools/oracle/phoneme-interpreter.mjs','tools/oracle/phoneme-interpreter-build-info.mjs','tools/compare/phoneme-interpreter.mjs','tools/compare/phoneme-interpreter-corpus.mjs','build/oracle/espeak-ng-data/phontab','build/oracle/espeak-ng-data/phonindex'];
  const snapshot=()=>names.map(name=>({path:name,sha256:fileHash(path.join(root,name))})),sources=snapshot();
  const bytes=new Uint8Array(readFileSync(path.join(referenceBuild,'espeak-ng-data/phonindex'))),tables=createPhonemeTables(new Uint8Array(readFileSync(path.join(referenceBuild,'espeak-ng-data/phontab'))));
  const cases=corpus||interpreterCorpus(tables),oracle=createPhonemeInterpreterOracle();
  mkdirSync(path.join(root,'artifacts'),{recursive:true});const directory=mkdtempSync(path.join(root,'artifacts/phoneme-interpreter-'));
  writeFileSync(path.join(directory,'requests.json'),JSON.stringify(cases)+'\n');let exact=0,clean=0,active=null,reference=null,profile=null;const batches=[];
  try{
    for(let at=0;at<cases.length;at+=512){
      const fixtures=cases.slice(at,at+512);active={batch:at,ids:fixtures.map(row=>row.id)};const result=oracle(fixtures.map(row=>row.request));reference=result.reference;profile=result.profile;
      assert.deepEqual(profile,{voice:'en-us',translatorName:25966,phonemeTable:80,reduce:0,klatt:0,useKlatt:1,useMbrola:0});
      const file='oracle-'+String(at).padStart(6,'0')+'.json';writeFileSync(path.join(directory,file),JSON.stringify(result)+'\n');batches.push({file,sha256:sha256(JSON.stringify(result))});
      for(let i=0;i<fixtures.length;i++){active={fixture:fixtures[i],expected:result.results[i]};assert.deepEqual(result.requests[i],normalizeInterpreterRequest(fixtures[i].request));const actual=runInterpreterJS(fixtures[i].request,tables,bytes);active.actual=actual;assert.deepEqual(actual,result.results[i],fixtures[i].id);exact++;}
      const plain=fixtures.filter(row=>!row.request.program).filter((_,i)=>i%19===0).map(row=>row.request);if(plain.length){assert.deepEqual(oracle(plain),oracle(plain,{clean:true}));clean+=plain.length;}
    }
    assert.deepEqual(snapshot(),sources);const report={schemaVersion:1,status:'passed-supported-slice',coverageComplete:false,totalCases:cases.length,exactCases:exact,cleanLibraryChecks:clean,reference,profile,sources,batches,artifactDirectory:directory,limitation:'Compiled bytecode execution and complete PHONEME_DATA/list/prev_vowel state; sound addresses are not audio rendering or device validation.'};writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');return report;
  }catch(error){writeFileSync(path.join(directory,'failure.json'),JSON.stringify({active,exact,error:error.stack},null,2)+'\n');throw new Error(directory+'\n'+error.stack);}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const result=verifyPhonemeInterpreter();console.log(JSON.stringify({total:result.totalCases,exact:result.exactCases,clean:result.cleanLibraryChecks,artifact:result.artifactDirectory}));}
