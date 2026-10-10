import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {root,referenceBuild,validateReference,fileHash,sha256} from './trace-build-info.mjs';
export const interpreterRoot=path.join(root,'build/oracle-phoneme-interpreter');
export const interpreterSource=path.join(root,'tools/oracle/phoneme-interpreter-oracle.c');
export const interpreterBinary=path.join(interpreterRoot,'phoneme-interpreter-oracle');
export const interpreterCleanBinary=path.join(interpreterRoot,'phoneme-interpreter-clean');
export function interpreterInputs(){return {reference:validateReference(),data:['phontab','phonindex','phondata','intonations'].map(name=>({path:name,sha256:fileHash(path.join(referenceBuild,'espeak-ng-data',name))})),helperSourceSha256:fileHash(interpreterSource),libraries:['src/libespeak-ng/libespeak-ng.a','src/ucd-tools/libucd.a'].map(name=>({path:name,sha256:fileHash(path.join(referenceBuild,name))})),sources:['synthdata.c','synthdata.h','synthesize.h','phoneme.h','translate.h','voice.h'].map(name=>({path:'src/libespeak-ng/'+name,sha256:fileHash(path.join(root,'upstream/espeak-ng/src/libespeak-ng',name))}))};}
export function validateInterpreterBuild(){const stamp=JSON.parse(readFileSync(path.join(interpreterRoot,'build-stamp.json'),'utf8'));assert.equal(stamp.schemaVersion,1);assert.deepEqual(stamp.inputs,interpreterInputs(),'Interpreter oracle inputs changed');assert.equal(stamp.binarySha256,fileHash(interpreterBinary));assert.equal(stamp.cleanBinarySha256,fileHash(interpreterCleanBinary));return {stamp,fingerprint:sha256(JSON.stringify(stamp))};}
