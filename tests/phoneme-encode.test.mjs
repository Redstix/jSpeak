import test from 'node:test';
import assert from 'node:assert/strict';
import { encodePhonemes } from '../src/core/phoneme-encode.js';
function table() {
  const entries=new Array(256).fill(null);
  for(const [code,name,type] of [[1,'t',3],[2,'s',3],[3,'ts',3],[4,'z',15],[5,'ts',3],[15,'||',0],[21,'_^_',0]]){
    let mnemonic=0;for(let i=0;i<name.length;i++)mnemonic|=name.charCodeAt(i)<<(i*8);
    entries[code]={code,mnemonic:mnemonic>>>0,type};
  }
  return {entries,nPhonemes:22};
}
const run=(text,options)=>encodePhonemes(new Uint8Array(Buffer.from(text)),table(),options);
test('longest complete mnemonic respects explicit separators and first equal match',()=>{
  assert.deepEqual(Array.from(run('ts').phonemes),[3]);
  assert.deepEqual(Array.from(run('t|s').phonemes),[1,2]);
  assert.deepEqual(Array.from(run('||||').phonemes),[15,15]);
  assert.deepEqual(run('z'),{phonemes:new Uint8Array(0),offset:1,badPhoneme:122});
});
test('language switch keeps internal separator but removes terminal default en',()=>{
  assert.deepEqual(run('_^_EN'),{phonemes:Uint8Array.of(21),offset:5,badPhoneme:0});
  assert.deepEqual(run('_^_EN t'),{phonemes:Uint8Array.of(21,101,110,124),offset:5,badPhoneme:0});
  assert.deepEqual(run('_^_FR'),{phonemes:Uint8Array.of(21,102,114),offset:5,badPhoneme:0});
});
test('bad UTF-8 reports decoded character while returning one byte past failure',()=>{
  assert.deepEqual(run('t😀s'),{phonemes:Uint8Array.of(1),offset:2,badPhoneme:0x1f600});
  assert.deepEqual(run('t😀s',{reportBadPhoneme:false}),{phonemes:Uint8Array.of(1),offset:2,badPhoneme:null});
  assert.deepEqual(encodePhonemes(Uint8Array.of(0x80,0x80,116),table()),{phonemes:new Uint8Array(0),offset:1,badPhoneme:116});
});
