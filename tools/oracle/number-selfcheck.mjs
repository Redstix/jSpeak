import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root, fileHash } from './trace-build-info.mjs';
import { createNumberOracle } from './number.mjs';
import { loadDictionary, createDictionarySession } from '../../src/core/dictionary.js';
import { createNumberTranslation } from '../../src/core/number-translation.js';
import { NUMBER_PROFILE } from '../../data/number/profile.js';

mkdirSync(path.join(root,'artifacts'),{recursive:true});
const out=mkdtempSync(path.join(root,'artifacts/oracle-number-'));
const dictionary=loadDictionary(new Uint8Array(readFileSync(path.join(root,'data/dictionary/en_dict.bin'))),JSON.parse(readFileSync(path.join(root,'data/dictionary/manifest.json'))));
const oracle=createNumberOracle(), clean=createNumberOracle({clean:true}), hex=b=>Buffer.from(b).toString('hex');
const numeric=s=>({speakMissingThousands:s.speakMissingThousands,numberControl:s.numberControl,nDigitLookup:s.nDigitLookup,ordinal2Hex:hex(s.ordinal2),ordinal2xHex:hex(s.ordinal2x)});
const dict=s=>({repeatCount:s.repeatCount,repeatHex:hex(s.repeat),skipWords:s.skipWords});
let active=null;const captures=[];let cleanComparisons=0;
const sourceNames=['src/core/number-translation.js','src/core/dictionary.js','data/number/profile.js','data/dictionary/en_dict.bin'];
const sourceSnapshot=sourceNames.map(name=>({path:name,sha256:fileHash(path.join(root,name))}));
try{
 function compare(request){
  active=request;const response=oracle(request),q=response.request,e=response.result;
  const session=createDictionarySession(dictionary);session.setState({repeatCount:q.state.repeatCount,repeat:Buffer.from(q.state.repeatHex,'hex'),skipWords:q.state.skipWords});
  const service=createNumberTranslation(session);service.setState({...Object.fromEntries(['speakMissingThousands','numberControl','nDigitLookup'].map(k=>[k,q.numberState[k]])),ordinal2:Buffer.from(q.numberState.ordinal2Hex,'hex'),ordinal2x:Buffer.from(q.numberState.ordinal2xHex,'hex')});
  const result=service[q.operation](new Uint8Array(Buffer.from(q.prefixHex+q.utf8Hex,'hex')),{offset:3,words:q.words,remaining:q.remaining,capacity:q.capacity,control:q.control,flags:q.flags,initialPhonemes:Buffer.from(q.initialPhonemesHex,'hex'),optionSayas:q.state.optionSayas,dictionaryContext:q.state});
  const actual={found:result.found,flags:Array.from(result.flags),phonemesHex:hex(result.phonemes),bufferAfterHex:hex(result.buffer),wordsAfter:result.words,
    numberStateBefore:numeric(result.stateBefore),numberStateAfter:numeric(result.stateAfter),dictionaryState:dict(result.dictionaryState),prevDictFlags0:result.prevDictFlags0,prevDictFlags1:result.prevDictFlags1};
  const expected={found:e.found,flags:e.flags,phonemesHex:e.phonemesHex,bufferAfterHex:e.bufferAfterHex,wordsAfter:e.wordsAfter,numberStateBefore:e.numberStateBefore,numberStateAfter:e.numberStateAfter,
    dictionaryState:Object.fromEntries(['repeatCount','repeatHex','skipWords'].map(k=>[k,e.stateAfter[k]])),prevDictFlags0:e.stateAfter.prevDictFlags0,prevDictFlags1:e.stateAfter.prevDictFlags1};
  assert.deepEqual(actual,expected,'Number '+JSON.stringify(request));
  if(captures.length%17===0&&!request.numberState){const plain=clean(request).result;const observed={...e},pristine={...plain};delete observed.numberStateBefore;delete observed.numberStateAfter;delete pristine.numberStateBefore;delete pristine.numberStateAfter;assert.deepEqual(observed,pristine,'Original source inclusion differs from clean library');cleanComparisons++;}
  captures.push(response);return response;
 }
 const simple=word=>({utf8Hex:Buffer.from(word+' ').toString('hex')});
 for(let i=0;i<1000;i++)compare(simple(String(i)));
 for(const n of [1000,1001,1009,1010,1011,1099,1100,1101,1899,1900,1901,1909,1910,1911,1945,1999,2000,2001,2010,2026,2099,2100,9999,10000,10001,12345,100000,999999,1000000,2147483647,2147483648])compare(simple(String(n)));
 for(const text of ['00','01','001','000','0000','0123','1 st','2 nd','3 rd','4 th','11 th','21 st','100 th','101 st','1000 th','23rd','6 .','6.','6. foo','6.7','0.01','2.009','12.345','1.2.3','1.234567890123456789012345678901234567890123456789012345678901234567890123456789',
  '1, 000','1, 234','12, 345, 678','1, 000, 000','1, 000, 100','1, 000, 001','999, 999, 999','2 000','02 : 30','42 %','42 dollars'])compare({...simple(text),words:Array(5).fill({}),remaining:5});
 for(const text of ['000','001','012','100','999'])for(const prefixHex of ['312c20','302c20','003120'])compare({...simple(text),prefixHex});
 for(const n of [1,2,3,4,10,20,21,22,100,101,1000,1001])compare({...simple(String(n)),words:[{flags:32768}]});
 for(const word of ['i','ii','iii','iv','v','vi','vii','viii','ix','x','xi','xiv','xix','xx','xxiv','xxxix','xl','xlix','l','mmxxvi','iiii','iiv','vx','ii x','xx 2','XX','hello'])for(const flags of [0,1,65536])compare({...simple(word),operation:'roman',words:[{flags}]});
 for(const word of ['0','1','42','009','1.5','1 st','iv'])for(const optionSayas of [0,193])for(const flags of [0,524288])compare({...simple(word),operation:word==='iv'?'roman':'number',words:[{flags}],state:{optionSayas,repeatCount:2,repeatHex:'010203',skipWords:3,prevDictFlags0:123,prevDictFlags1:456},numberState:{speakMissingThousands:2,numberControl:1,nDigitLookup:2,ordinal2Hex:'0102',ordinal2xHex:'0304'},initialPhonemesHex:'010203',flags:[123,456]});
 for(const word of ['1 st','23 rd','000','100','iv'])for(const remaining of [0,1])compare({...simple(word),operation:word==='iv'?'roman':'number',remaining,words:[{flags:32769}],state:{expectVerb:-1,expectVerbS:-1,expectNoun:-1,expectPast:-1},prefixHex:'312c20',numberState:{speakMissingThousands:-2147483648}});
 assert.deepEqual(captures[42],oracle(captures[42].request));
 assert.deepEqual(sourceNames.map(name=>({path:name,sha256:fileHash(path.join(root,name))})),sourceSnapshot,'Number selfcheck inputs changed during verification');
 const report={schemaVersion:1,kind:'original-C-vs-JS-fixed-en-us-number-and-roman',status:'passed',reference:captures[0].reference,profile:NUMBER_PROFILE,comparisons:captures.length,cleanLibraryComparisons:cleanComparisons,
  sources:sourceSnapshot,
  scope:'Fixed en-us profile, 200-byte or larger output capacity, ordinary nonnegative numeric input, explicit caller and static number state. Full multiword orchestration is a separate stage.'};
 writeFileSync(path.join(out,'captures.json'),JSON.stringify(captures,null,2)+'\n');writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log('PASS '+captures.length+' C/JS number/roman outputs and states, '+cleanComparisons+' clean-library checks; report '+path.join(out,'report.json'));
}catch(error){writeFileSync(path.join(out,'failure.json'),JSON.stringify({active,error:error.stack},null,2)+'\n');throw error;}
