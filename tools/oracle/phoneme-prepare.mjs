import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import path from 'node:path';
import {referenceBuild} from './trace-build-info.mjs';import {phonemePrepareBinary,validatePhonemePrepareBuild} from './phoneme-prepare-build-info.mjs';
const columns=['phcode','stresslevel','wordstress','tonePh','sourceix','synthflags'];
export function createPhonemePrepareOracle(){const identity=validatePhonemePrepareBuild();return function oracle(requests=[]){
  assert(Array.isArray(requests)&&requests.length<=128);
  const normalized=requests.map(({list,postPause=0,startSentence=false})=>{
    assert(list&&Number.isInteger(list.length)&&list.length>=3&&list.length<=1000);
    for(const [index,name]of columns.entries())assert((Array.isArray(list[name])||ArrayBuffer.isView(list[name]))&&list[name].length===1000&&Array.from(list[name]).every(value=>Number.isInteger(value)&&value>=0&&value<=(index<4?255:65535)),'Invalid full list column '+name);
    assert(list.phcode[list.length-1]===9&&list.phcode[list.length-2]===9,'Original caller must supply two trailing pauses');
    assert(Number.isInteger(postPause)&&postPause>=-0x80000000&&postPause<=0x7fffffff&&typeof startSentence==='boolean');
    return{list:{length:list.length,...Object.fromEntries(columns.map(name=>[name,Array.from(list[name])]))},postPause,startSentence};
  });
  const input=normalized.map(row=>`${row.list.length} ${row.postPause} ${Number(row.startSentence)}\n`+Array.from({length:1000},(_,i)=>columns.map(name=>row.list[name][i]).join(' ')).join('\n')+'\n').join('');
  assert.deepEqual(validatePhonemePrepareBuild(),identity);
  const response=JSON.parse(execFileSync(phonemePrepareBinary,[path.join(referenceBuild,'espeak-ng-data')],{input,encoding:'utf8',timeout:30000,maxBuffer:64*1024*1024,env:{...process.env,LC_ALL:'C'}}));assert.equal(response.results.length,requests.length);
  return{schemaVersion:1,reference:{fingerprint:identity.fingerprint},requests:normalized,...response};
};}
