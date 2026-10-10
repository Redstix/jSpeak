import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPhonemeTables} from '../src/core/phoneme-table.js';
import {createPhonemeListSession,PHONEME_LIST_PROFILE} from '../src/core/phoneme-list.js';
const table=createPhonemeTables(readFileSync(new URL('../build/oracle/espeak-ng-data/phontab',import.meta.url))).select(80);
const session=initial=>createPhonemeListSession(table,PHONEME_LIST_PROFILE,initial);
const rows=snapshot=>Object.fromEntries(['phcode','stresslevel','wordstress','tonePh','sourceix','synthflags'].map(name=>[name,Array.from(snapshot.list[name].subarray(0,snapshot.list.length))]));

test('list builder transfers stress to vowels and adjacent consonants and preserves word boundaries',()=>{
  const builder=session();
  const result=builder.appendWord(Uint8Array.of(6,35,55,3,35),{dictionaryFlags:0x80000000,sourceIndex:5,wordLength:40});
  assert.equal(result.flags,0x80000000);assert.deepEqual(rows(builder.snapshot()),{
    phcode:[10,35,55,35],stresslevel:[0,4,0,0],wordstress:[0,0,0,0],tonePh:[0,0,0,0],sourceix:[0,63493,0,0],synthflags:[0,20,16,20]
  });
  assert.equal(builder.state().anyStressedWords,true);assert.equal(builder.state().endStressedVowel,0);
  builder.appendWord(Uint8Array.of(6,35,15,35),{sourceIndex:2047,wordLength:31});
  assert.equal(builder.snapshot().list.sourceix[5],0); // source_ix + 1 wraps the uint16 field
});

test('syllabic and length markers update the prior row without creating virtual rows',()=>{
  const builder=session();builder.appendWord(Uint8Array.of(6,55,20,12),{});
  assert.equal(builder.length(),2);assert.equal(builder.snapshot().list.stresslevel[1],4);
  assert.equal(builder.snapshot().list.synthflags[1],12);
  assert.equal(builder.state().anyStressedWords,false);
  builder.appendWord(Uint8Array.of(55),{dictionaryFlags:1024});
  assert.equal(builder.snapshot().list.synthflags[0],64); // no vowel: original max_stress_ix remains zero
});

test('pauses consume embedded state and clear preceding-word doubling; hyphens omit input pause',()=>{
  const builder=session({state:{embeddedFlag:2,prevDictFlags0:16384,prevDictFlags1:123}});
  builder.appendWord(Uint8Array.of(55),{prePause:3,sourceIndex:7,wordLength:2});
  assert.deepEqual(rows(builder.snapshot()).phcode,[10,9,11,55]);
  assert.deepEqual(rows(builder.snapshot()).synthflags,[0,2,0,0]);
  assert.equal(builder.state().prevDictFlags1,0);
  builder.setState({prevDictFlags0:16384});
  builder.appendWord(Uint8Array.of(9,55),{wordFlags:128});
  assert.equal(builder.snapshot().list.phcode[4],55);assert.equal(builder.snapshot().list.synthflags[4],8);
});

test('capital indicators, pitch restore and dictionary text mode preserve original assignments',()=>{
  const builder=session({state:{optionCapitals:1,embeddedFlag:2}});
  builder.appendWord(Uint8Array.of(6,35),{wordFlags:3,wordBytes:Buffer.from('AB'),dictionaryFlags:0xa0000000,pitchRaised:20});
  assert.deepEqual(rows(builder.snapshot()).phcode,[10,10,18,10,18,35,10]);
  assert.equal(builder.snapshot().list.synthflags[5],4); // FLAG_TEXTMODE excludes dictionary marking
  assert.equal(builder.snapshot().list.synthflags[6],2);
  assert.equal(builder.state().embeddedList[0],0x14e1);
});

test('empty output retains caller arena and injects an embedded pause only when needed',()=>{
  const builder=session();builder.appendWord(new Uint8Array(),{sourceIndex:4,wordLength:2});
  assert.equal(builder.length(),1);assert.equal(builder.snapshot().list.sourceix[1],4100);
  builder.setState({embeddedFlag:2});const result=builder.appendWord(new Uint8Array(),{});
  assert.deepEqual(Array.from(result.phonemes),[23]);assert.equal(builder.length(),2);
  assert.equal(builder.snapshot().list.synthflags[1],2);
});

test('arena lifecycle preserves unwritten residue and matches clause/embedded marker fields',()=>{
  const original=session().snapshot();original.list.length=2;
  original.list.wordstress.fill(27);original.list.tonePh.fill(99);original.list.stresslevel.fill(7);original.list.phcode.fill(10);
  const builder=session(original);builder.setState({embeddedFlag:2});assert.equal(builder.appendEmbeddedWordEnd(),true);
  const marked=builder.snapshot();assert.equal(marked.list.phcode[2],15);assert.equal(marked.list.wordstress[2],0);assert.equal(marked.list.tonePh[2],0);
  builder.finishClause(0x12345678);const finished=builder.snapshot();
  assert.equal(builder.length(),5);assert.equal(finished.list.sourceix[3],0x5678);
  assert.equal(finished.list.wordstress[3],27);assert.equal(finished.list.tonePh[3],99);
  builder.beginClause();const reset=builder.snapshot();assert.equal(builder.length(),1);assert.equal(reset.list.phcode[0],10);
  assert.equal(reset.list.wordstress[0],0);assert.equal(reset.list.wordstress[3],27);
  reset.list.phcode.fill(0);assert.equal(builder.snapshot().list.phcode[0],10);
});

test('capacity reservations and unsupported table switches are explicit',()=>{
  const snapshot=session().snapshot();snapshot.list.length=990;
  const builder=session(snapshot);builder.appendWord(new Uint8Array(199).fill(35),{prePause:1999,wordFlags:131072});
  assert.equal(builder.length(),996);builder.finishClause(1);assert.equal(builder.length(),998);
  assert.equal(builder.appendEmbeddedWordEnd(),false);
  assert.throws(()=>builder.appendWord(Uint8Array.of(35),{}),/reserve/);
  assert.throws(()=>session({list:{...snapshot.list,length:0}}),/initial count/);
  assert.throws(()=>session().appendWord(Uint8Array.of(21,80),{}),e=>e.code==='PHONEME_LIST_UNSUPPORTED'&&e.reason==='phoneme-table-switch');
  assert.throws(()=>session().appendWord(Uint8Array.of(35),{switchPhonemes:80}),e=>e.reason==='alternate-translator');
});
