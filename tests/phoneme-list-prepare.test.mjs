import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {createPhonemeTables} from '../src/core/phoneme-table.js';import {preparePhonemeList,PHONEME_PREPARE_PROFILE} from '../src/core/phoneme-list-prepare.js';
import {prepareFixture} from '../tools/oracle/phoneme-prepare-selfcheck.mjs';
const table=createPhonemeTables(readFileSync(new URL('../build/oracle/espeak-ng-data/phontab',import.meta.url))).select(80);
const prepare=fixture=>preparePhonemeList(prepareFixture(fixture),table,PHONEME_PREPARE_PROFILE);

test('preparation applies measured en-us voice replacements only at unstressed word endings',()=>{
  assert.equal(prepare({codes:[126]}).working.phcode[1],37);
  assert.equal(prepare({codes:[113]}).working.phcode[1],37);
  assert.equal(prepare({codes:[126],stress:[4]}).working.phcode[1],126);
  assert.equal(prepare({codes:[126,55],source:[1,0]}).working.phcode[1],126);
  assert.equal(prepare({codes:[126,55],source:[1,2]}).working.phcode[1],37);
  assert.equal(prepare({codes:[126],flags:[32]}).working.phcode[1],126);
});

test('preparation promotes an eligible preceding word and assigns its maximum stress to all its rows',()=>{
  const result=prepare({codes:[35,55,35],stress:[1,1,1],source:[123,0,999],flags:[64,0,0]});
  assert.equal(result.list2.stresslevel[1],4);
  assert.deepEqual(Array.from(result.working.wordstress.subarray(1,4)),[4,4,1]);
  assert.equal(prepare({codes:[35,55,35],stress:[1,4,1],source:[123,0,999],flags:[64,0,0]}).list2.stresslevel[1],1);
});

test('deletion preserves original source-marker transfer including a zero marker',()=>{
  for(const code of [0,255]){
    const result=prepare({codes:[code,35],source:[123,0]});
    assert.equal(result.working.count,4);assert.equal(result.working.phcode[1],35);assert.equal(result.working.sourceix[1],123);
  }
  assert.equal(prepare({codes:[0,35],source:[0,567]}).working.sourceix[1],0);
});

test('redundant switches collapse while the real initial pause pointer stays distinct from its code',()=>{
  const result=prepare({codes:[21,35],source:[321,0],tones:[80,0]});
  assert.equal(result.list2.length,4);assert.equal(result.working.sourceix[1],321);
  assert.equal(result.working.phcode[0],10);assert.equal(result.working.phonemeId[0],10);
  assert.equal(result.bodyLength,2);assert.equal(result.endSourceIndex,99);
});

test('preparation owns output and rejects unsupported language tables and invalid caller boundaries',()=>{
  const input=prepareFixture({codes:[126],seed:1}),saved=input.phcode.slice();
  const result=preparePhonemeList(input,table,PHONEME_PREPARE_PROFILE);result.list2.phcode.fill(0);result.working.phcode.fill(0);
  assert.deepEqual(input.phcode,saved);
  assert.throws(()=>prepare({codes:[21,35],tones:[1,0]}),e=>e.code==='PHONEME_PREPARE_UNSUPPORTED'&&e.reason==='phoneme-table-switch');
  input.phcode[input.length-1]=10;
  assert.throws(()=>preparePhonemeList(input,table,PHONEME_PREPARE_PROFILE),/terminating pauses/);
});
