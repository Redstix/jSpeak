import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {referenceBuild} from './trace-build-info.mjs';
import {phonemeListBinary,validatePhonemeListBuild} from './phoneme-list-build-info.mjs';
export function createPhonemeListOracle() {
  const identity=validatePhonemeListBuild();
  return function oracle(requests=[]) {
    assert(Array.isArray(requests)&&requests.length<=256);
    const normalized=requests.map(({wordHex='',wordFlags=0,prePause=0,count=1,seed=0,optionCapitals=0,embeddedFlag=0,embeddedIndex=0,prevDictFlags0=0,prevDictFlags1=0,endStressedVowel=0,anyStressedWords=false,sourceIndex=1,wordLength=1,operation=0})=>{
      assert(typeof wordHex==='string'&&wordHex.length<=398&&/^(?:[0-9a-f]{2})*$/.test(wordHex)&&!Buffer.from(wordHex,'hex').includes(0));
      for(const value of[wordFlags,prevDictFlags0,prevDictFlags1])assert(Number.isInteger(value)&&value>=0&&value<=0xffffffff);
      assert(!(wordFlags&64),'Embedded parsing is before the observed list-builder boundary');
      for(const value of[prePause,optionCapitals,embeddedFlag,endStressedVowel])assert(Number.isInteger(value)&&value>=-0x80000000&&value<=0x7fffffff);
      assert(Number.isInteger(operation)&&operation>=0&&operation<=3);
      assert(Number.isInteger(count)&&count>=1&&count<=(operation===0?990:operation===2?998:1000));assert(seed===0||seed===1);
      assert(Number.isInteger(embeddedIndex)&&embeddedIndex>=0&&embeddedIndex<=243);
      assert(Number.isInteger(sourceIndex)&&sourceIndex>=0&&sourceIndex<=(operation===0?65535:0xffffffff));assert(Number.isInteger(wordLength)&&wordLength>=0&&wordLength<=255);
      assert(typeof anyStressedWords==='boolean');
      return{wordHex,wordFlags,prePause,count,seed,optionCapitals,embeddedFlag,embeddedIndex,prevDictFlags0,prevDictFlags1,endStressedVowel,anyStressedWords,sourceIndex,wordLength,operation};
    });
    const input=normalized.map(r=>`${r.wordFlags} ${r.prePause} ${r.count} ${r.seed} ${r.optionCapitals} ${r.embeddedFlag} ${r.embeddedIndex} ${r.prevDictFlags0} ${r.prevDictFlags1} ${r.endStressedVowel} ${Number(r.anyStressedWords)} ${r.sourceIndex} ${r.wordLength} ${r.wordHex||'-'} ${r.operation}\n`).join('');
    assert.deepEqual(validatePhonemeListBuild(),identity);
    const response=JSON.parse(execFileSync(phonemeListBinary,[path.join(referenceBuild,'espeak-ng-data')],{input,encoding:'utf8',timeout:30000,maxBuffer:64*1024*1024,env:{...process.env,LC_ALL:'C'}}));
    assert.equal(response.results.length,requests.length);
    return{schemaVersion:1,reference:{fingerprint:identity.fingerprint},requests:normalized,...response};
  };
}
