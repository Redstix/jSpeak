import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { root, referenceBuild, validateReference, fileHash, sha256 } from './trace-build-info.mjs';
export const wordEndingRoot=path.join(root,'build/oracle-word-ending');
export const wordEndingSource=path.join(root,'tools/oracle/word-ending-oracle.c');
export const wordEndingBinary=path.join(wordEndingRoot,'word-ending-oracle');
export function wordEndingInputs(){return{reference:validateReference(),helperSourceSha256:fileHash(wordEndingSource),
  libraries:['src/libespeak-ng/libespeak-ng.a','src/ucd-tools/libucd.a'].map(name=>({path:name,sha256:fileHash(path.join(referenceBuild,name))})),
  sources:['src/libespeak-ng/dictionary.c','src/libespeak-ng/translate.h','src/libespeak-ng/tr_languages.c'].map(name=>({path:name,sha256:fileHash(path.join(root,'upstream/espeak-ng',name))}))};}
export function validateWordEndingBuild(){const stamp=JSON.parse(readFileSync(path.join(wordEndingRoot,'build-stamp.json'),'utf8'));assert.equal(stamp.schemaVersion,1);assert.deepEqual(stamp.inputs,wordEndingInputs(),'Word-ending reference changed: rebuild');assert.equal(stamp.binarySha256,fileHash(wordEndingBinary),'Word-ending helper binary changed');return{stamp,fingerprint:sha256(JSON.stringify(stamp))};}
