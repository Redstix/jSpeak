import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadDictionary, createDictionarySession } from '../src/core/dictionary.js';
import { createNumberTranslation } from '../src/core/number-translation.js';
const dictionary=loadDictionary(new Uint8Array(readFileSync(new URL('../data/dictionary/en_dict.bin',import.meta.url))),JSON.parse(readFileSync(new URL('../data/dictionary/manifest.json',import.meta.url))));
const input=text=>new Uint8Array(Buffer.from('\0  '+text+' '));
test('individual digits delegates with incoming outputs and static state preserved',()=>{
  const dictionarySession=createDictionarySession(dictionary),service=createNumberTranslation(dictionarySession);
  service.setState({speakMissingThousands:2,numberControl:1,nDigitLookup:2,ordinal2:Uint8Array.of(1,2)});
  const before=service.state(),source=input('42');
  const result=service.number(source,{optionSayas:193,flags:[123,456],initialPhonemes:Uint8Array.of(1,2,3)});
  assert.equal(result.found,0);assert.deepEqual(Array.from(result.flags),[123,456]);assert.deepEqual(result.phonemes,Uint8Array.of(1,2,3));
  assert.deepEqual(result.stateAfter,before);assert.deepEqual(result.buffer,source);
});
test('full preceding thousands context suppresses an all-zero group',()=>{
  const service=createNumberTranslation(createDictionarySession(dictionary));
  const isolated=service.number(input('000'));
  const grouped=service.number(new Uint8Array(Buffer.from('\0  1, 000 ')),{offset:6});
  assert.equal(grouped.found,1);assert.deepEqual(Array.from(grouped.phonemes),[15,15]);assert.notDeepEqual(grouped.phonemes,isolated.phonemes);
});
test('Roman bounds and lowercase tokenizer contract follow the original parser',()=>{
  const service=createNumberTranslation(createDictionarySession(dictionary));
  assert.equal(service.roman(input('xlix')).found,1);
  for(const word of ['i','v','x','l','iiii','vx','XX'])assert.equal(service.roman(input(word)).found,0,word);
});
