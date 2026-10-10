import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {root,referenceBuild,validateReference,fileHash,sha256} from './trace-build-info.mjs';
export const phonemeListRoot=path.join(root,'build/oracle-phoneme-list');
export const phonemeListSource=path.join(root,'tools/oracle/phoneme-list-oracle.c');
export const phonemeListObserved=path.join(phonemeListRoot,'translate-boundary.c');
export const phonemeListBinary=path.join(phonemeListRoot,'phoneme-list-oracle');
export function phonemeListInputs(){return{reference:validateReference(),helperSourceSha256:fileHash(phonemeListSource),builderSha256:fileHash(path.join(root,'tools/oracle/phoneme-list-build.mjs')),
  libraries:['src/libespeak-ng/libespeak-ng.a','src/ucd-tools/libucd.a'].map(name=>({path:name,sha256:fileHash(path.join(referenceBuild,name))})),
  sources:['src/libespeak-ng/translate.c','src/libespeak-ng/translate.h','src/libespeak-ng/synthesize.h','src/libespeak-ng/phoneme.h'].map(name=>({path:name,sha256:fileHash(path.join(root,'upstream/espeak-ng',name))})),
  dictionarySha256:fileHash(path.join(referenceBuild,'espeak-ng-data/en_dict')),phontabSha256:fileHash(path.join(referenceBuild,'espeak-ng-data/phontab'))};}
export function validatePhonemeListBuild(){const stamp=JSON.parse(readFileSync(path.join(phonemeListRoot,'build-stamp.json'),'utf8'));assert.equal(stamp.schemaVersion,1);assert.deepEqual(stamp.inputs,phonemeListInputs(),'Phoneme-list reference changed');assert.equal(stamp.binarySha256,fileHash(phonemeListBinary));assert.equal(stamp.observedSourceSha256,fileHash(phonemeListObserved));return{stamp,fingerprint:sha256(JSON.stringify(stamp))};}
