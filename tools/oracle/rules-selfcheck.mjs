import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { root, referenceBuild, fileHash, sha256 } from './trace-build-info.mjs';
import { createRulesOracle, createRulesAppendOracle } from './rules.mjs';
import { loadDictionary, createDictionarySession } from '../../src/core/dictionary.js';
import { createPhonemeTables } from '../../src/core/phoneme-table.js';
import { createDictionaryRulesSession, RULE_PROFILE } from '../../src/core/dictionary-rules.js';

export function makeRulesCorpus() {
  const rows = [];
  const add = (word, options = {}) => rows.push({ id: `rules-${rows.length}`, wordHex: Buffer.from(word).toString('hex'), ...options });
  const words = ['a','cat','hello','world','testing','happy','reading','reconstruction','unpronounceable','queue','rhythm','walked','watches','judges','produce','record','resume','resumé','naïve','coöperate','café','ɒ','α','Ω','Русский','汉字',"can't","John's",'42','a1b2','1234567890'];
  for (const word of words) add(word);
  for (let a = 97; a <= 122; a++) {
    add([a]);
    for (let b = 97; b <= 122; b++) add([a, b]);
  }
  for (const word of ['testing','reading','happy','hopeful','repaint','understand','record','produce','misunderstanding','lovely','queue','consonant']) {
    for (const wordFlags of [0,2,128,8192,16384,8388608,134217728,536870912,2147483648]) add(word, { wordFlags });
    for (const dictFlags of [[0,0],[32768,0],[65536,0],[131072,0],[0x80000000,0]]) add(word, { dictFlags });
    for (const phSize of [1,2,3,8,20,159,200]) add(word, { phSize, endPhonemesEnabled: false });
    add(word, { expectVerb: 1 });
    add(word, { dictCondition: 0 });
    add(word, { dictCondition: 0xffffffff });
    add(word, { phonemesHex: '060d', phSize: 20, endPhonemesEnabled: false });
  }
  for (const size of [0,1,2,3,40,80,120,157,158,159]) add('a'.repeat(size), { endPhonemesEnabled: false });
  let random = 0x5eed0304;
  const next = () => { random ^= random << 13; random ^= random >>> 17; random ^= random << 5; return random >>> 0; };
  for (let i = 0; i < 1024; i++) {
    const text = Array.from({ length: 1 + next() % 30 }, () => String.fromCharCode(97 + next() % 26)).join('');
    add(text, { endPhonemesEnabled: next() % 2 === 0, wordFlags: next() % 2 ? 0 : 2 });
  }
  for (const word of ['cat', 's', 'a', 'ion', 'ed', 'ing', 'E', 'é', 'naïve', 'testing', 'record', 'produce']) {
    for (const prefixHex of ['2020', '0020', '0000', '205f', '6162', '2061', '202d', '2027', 'c3a9']) add(word, { prefixHex });
  }
  for (let byte = 0; byte < 256; byte++) if (byte < 0xc0 || byte > 0xf7) add('a', { prefixHex: Buffer.from([32, byte]).toString('hex') });
  for (const first of ['cat', 'testing', 'naïve', 'sponges']) for (const length of [159, 160, 161, 256, 512, 1024, 4096]) {
    const word = first + ' ' + 'a'.repeat(length - Buffer.byteLength(first) - 1);
    add(word); add(word, { prefixHex: '205f', endPhonemesEnabled: false });
  }
  for (const length of [160, 161, 200, 511, 1024, 4096]) { add('a'.repeat(length)); add('b'.repeat(length - 5) + 'café'); }
  for (const prefixLength of [154, 155, 156, 157, 158, 159, 160]) add('b'.repeat(prefixLength) + 'hopeful', { endPhonemesEnabled: false });
  for (const prefix of ['\0  ', ' xx', ' ax', ' consonant', ' vowel', ' \0\0', ' café', ' 雪', '\0 ']) {
    for (const word of ['a', 'cat', 'testing', 'hopeful', 'record', 'produce', 'café', 'ɒ']) for (const endPhonemesEnabled of [true, false]) {
      const front = Buffer.from(prefix), body = Buffer.from(word + ' other words ');
      const backing = Buffer.concat([front, body, Buffer.from([0, 69, 69, 32, 0]), Buffer.alloc(16)]);
      add(body, { bufferHex: backing.toString('hex'), offset: front.length, endPhonemesEnabled });
    }
  }
  for (const endPhonemesEnabled of [true, false]) add('', { bufferHex: '200000000000', offset: 1, endPhonemesEnabled });
  return rows;
}

export function makeAppendCorpus() {
  const rows = [];
  const add = (input, added, settings = {}) => rows.push({ phonemesHex: Buffer.from(input).toString('hex'), addedHex: Buffer.from(added).toString('hex'), capacity: 200, wordVowelCount: 7, wordStressedCount: 3, prePause: 4, ...settings });
  for (let code = 0; code < 256; code++) for (const marker of [[], [3], [6]]) for (const capacity of [1, 3, 200]) add([13], [...marker, code], { capacity });
  for (const length of [0, 1, 2, 197, 198, 199, 200, 400]) {
    for (const capacity of [1, 2, 199, 200]) {
      add(new Uint8Array(length).fill(13), [13], { capacity });
      add([], new Uint8Array(length).fill(13), { capacity });
    }
  }
  for (const count of [-0x80000000, -1, 0, 0x7ffffffe, 0x7fffffff]) add([], [35, 35, 35], { wordVowelCount: count, wordStressedCount: count });
  let random = 0x5eedab02;
  const next = () => { random ^= random << 13; random ^= random >>> 17; random ^= random << 5; return random >>> 0; };
  for (let i = 0; i < 1024; i++) {
    const bytes = () => Uint8Array.from({ length: next() % 100 }, () => next() & 255);
    add(bytes(), bytes(), { capacity: 1 + next() % 200, wordVowelCount: next() | 0, wordStressedCount: next() | 0, prePause: next() | 0 });
  }
  return rows;
}

export function verifyRules({ directory } = {}) {
  const names = ['src/core/dictionary-rules.js','src/core/dictionary.js','src/core/phoneme-table.js','src/core/utf8-scan.js','src/core/unicode.js','src/core/text-character.js',
    'data/dictionary/en_dict.bin','data/dictionary/manifest.json','data/rules/profile.js','data/rules/manifest.json','tools/oracle/rules.mjs','tools/oracle/rules-selfcheck.mjs'];
  const snapshot = () => names.map(name => ({ path: name, sha256: fileHash(path.join(root, name)) }));
  const files = snapshot();
  const dictionary = loadDictionary(readFileSync(path.join(root,'data/dictionary/en_dict.bin')),JSON.parse(readFileSync(path.join(root,'data/dictionary/manifest.json'))));
  const table = createPhonemeTables(readFileSync(path.join(referenceBuild,'espeak-ng-data/phontab'))).select(80);
  const oracle = createRulesOracle(), initial = oracle();
  const { letterBits, letterGroups, removeAccent, ...profile } = initial.profile;
  assert.deepEqual(profile, RULE_PROFILE);
  const requests = makeRulesCorpus(), appendRequests = makeAppendCorpus(), appendOracle = createRulesAppendOracle();
  if (!directory) { mkdirSync(path.join(root,'artifacts'),{recursive:true}); directory=mkdtempSync(path.join(root,'artifacts/dictionary-rules-')); }
  mkdirSync(directory,{recursive:true});
  const requestBytes=JSON.stringify(requests,null,2)+'\n'; writeFileSync(path.join(directory,'requests.json'),requestBytes);
  const appendBytes=JSON.stringify(appendRequests,null,2)+'\n'; writeFileSync(path.join(directory,'append-requests.json'),appendBytes);
  let active = null;
  try {
    for(let offset=0;offset<requests.length;offset+=128) {
      const rows=requests.slice(offset,offset+128);
      active={batchOffset:offset};
      const reference=oracle(rows.map(({id,...row})=>row));
      assert.deepEqual(reference.reference,initial.reference);assert.deepEqual(reference.profile,initial.profile);
      rows.forEach((row,index)=>{
        active={index:offset+index,request:row};
        const dictSession=createDictionarySession(dictionary);
        const session=createDictionaryRulesSession(dictionary,table,RULE_PROFILE,{dictionarySession:dictSession,lookup(bytes){
          const result=dictSession.lookup(bytes,{dictCondition:row.dictCondition??72,expectVerb:row.expectVerb??0});
          assert.equal(result.found,1,'Digit Lookup requires actual dictionary entry; no TranslateWord fallback in this fixture');
          return result.phonemes;
        }});
        const settings={...row,dictFlags:row.dictFlags?Uint32Array.from(row.dictFlags):null,
          phonemes:Buffer.from(row.phonemesHex||'','hex'),prefixBytes:row.prefixHex===undefined?undefined:Buffer.from(row.prefixHex,'hex'),prePause:row.prePause??0};
        const result=row.bufferHex===undefined?session.translate(Buffer.from(row.wordHex,'hex'),settings):session.translateBuffer(Buffer.from(row.bufferHex,'hex'),row.offset,settings);
        const actual={endType:result.endType,wordHex:Buffer.from(result.word).toString('hex'),phonemesHex:Buffer.from(result.phonemes).toString('hex'),endPhonemesHex:Buffer.from(result.endPhonemes).toString('hex'),dictFlags:result.dictFlags?Array.from(result.dictFlags):null,stateAfter:result.stateAfter};
        if(result.source)actual.sourceHex=Buffer.from(result.source).toString('hex');
        assert.deepEqual(actual,reference.results[index],`C TranslateRules ${row.id}`);
      });
    }
    for(let offset=0;offset<appendRequests.length;offset+=256) {
      const rows=appendRequests.slice(offset,offset+256);
      active={appendBatchOffset:offset};
      const reference=appendOracle(rows); assert.deepEqual(reference.reference,initial.reference);
      rows.forEach((row,index)=>{
        active={appendIndex:offset+index,request:row};
        const session=createDictionaryRulesSession(dictionary,table,RULE_PROFILE);
        session.setState({wordVowelCount:row.wordVowelCount,wordStressedCount:row.wordStressedCount,prePause:row.prePause});
        const result=session.appendPhonemes(Buffer.from(row.phonemesHex,'hex'),Buffer.from(row.addedHex,'hex'),row.capacity);
        const {wordVowelCount,wordStressedCount,prePause}=session.state();
        assert.deepEqual({phonemesHex:Buffer.from(result).toString('hex'),stateAfter:{wordVowelCount,wordStressedCount,prePause}},reference.results[index],`C AppendPhonemes ${offset+index}`);
      });
    }
    assert.deepEqual(snapshot(),files,'Rule/dependency files changed during comparison');
    assert.deepEqual(createRulesOracle()().reference,initial.reference,'C rules reference changed');
  }catch(error){writeFileSync(path.join(directory,'failure.json'),JSON.stringify({schemaVersion:1,status:'failed',active,error:error.stack,files,reference:initial.reference},null,2)+'\n');error.message+='\nFailure artifact: '+path.join(directory,'failure.json');throw error;}
  const report={schemaVersion:1,status:'passed',scope:'Fixed en-us original TranslateRules with shared LookupDictList, complete buffer plus word offset, bounded two-byte prefix context and source through 4096 bytes, plus public AppendPhonemes and explicit counters; no TranslateWord/LookupLetter fallback',prefixBacking:{default:[0,32,32],explicit:['space','prefix0','prefix1'],limitation:'Only the supplied two-byte context; no equivalence to arbitrary earlier CLI text; UTF-8 leads crossing into word are rejected',fullBuffer:'Exact provided bytes, including pre-word NUL and post-word backing; no synthetic prefix'},cases:requests.length,fullBufferCases:requests.filter(row=>row.bufferHex!==undefined).length,appendCases:appendRequests.length,requestsSha256:sha256(requestBytes),appendRequestsSha256:sha256(appendBytes),files,reference:initial.reference,profile:RULE_PROFILE,artifactDirectory:directory};
  writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){if(process.argv.length!==2)throw new Error('Usage: node tools/oracle/rules-selfcheck.mjs');console.log(JSON.stringify(verifyRules(),null,2));}
