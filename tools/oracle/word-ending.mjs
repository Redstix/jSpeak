import assert from'node:assert/strict';import{execFileSync}from'node:child_process';import path from'node:path';
import{referenceBuild}from'./trace-build-info.mjs';import{wordEndingBinary,validateWordEndingBuild}from'./word-ending-build-info.mjs';
export function createWordEndingOracle(){const identity=validateWordEndingBuild();return function oracle(requests=[]){
  assert(Array.isArray(requests)&&requests.length<=16384);
  const normalized=requests.map(({wordHex,endType,expectVerb=0,copyWord=true})=>{
    assert(typeof wordHex==='string'&&wordHex.length<=8192&&/^(?:[0-9a-f]{2})*$/.test(wordHex));
    for(const value of[endType,expectVerb])assert(Number.isInteger(value)&&value>=-0x80000000&&value<=0x7fffffff);
    assert(typeof copyWord==='boolean');return{wordHex,endType,expectVerb,copyWord};
  });
  const input=normalized.map(row=>`${row.endType} ${row.expectVerb} ${Number(row.copyWord)} ${row.wordHex||'-'}\n`).join('');
  assert.deepEqual(validateWordEndingBuild(),identity);
  const response=JSON.parse(execFileSync(wordEndingBinary,[path.join(referenceBuild,'espeak-ng-data')],{input,encoding:'utf8',timeout:30000,maxBuffer:40*1024*1024,env:{...process.env,LC_ALL:'C'}}));
  assert.equal(response.results.length,requests.length);return{schemaVersion:1,reference:{fingerprint:identity.fingerprint},requests:normalized,...response};
};}
