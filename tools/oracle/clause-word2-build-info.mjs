import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { root, referenceBuild, validateReference, fileHash, sha256 } from './trace-build-info.mjs';
export const clauseWord2Root=path.join(root,'build/oracle-clause-word2');
export const clauseWord2Binary=path.join(clauseWord2Root,'espeak-ng');
export function clauseWord2Inputs(){return {reference:validateReference(),files:[
  'tools/oracle/clause-word2-observer.h','tools/oracle/word-shared.h','tools/oracle/clause-word2-build.mjs',
  'upstream/espeak-ng/src/libespeak-ng/translate.c','upstream/espeak-ng/src/libespeak-ng/synthdata.c',
  'upstream/espeak-ng/src/libespeak-ng/translate.h','upstream/espeak-ng/src/libespeak-ng/synthesize.h',
  ...['src/CMakeFiles/espeak-ng-bin.dir/espeak-ng.c.o','src/libespeak-ng/libespeak-ng.a','src/ucd-tools/libucd.a'].map(name=>path.relative(root,path.join(referenceBuild,name)))
].map(name=>({path:name,sha256:fileHash(path.join(root,name))}))};}
export function validateClauseWord2Build(){const stamp=JSON.parse(readFileSync(path.join(clauseWord2Root,'build-stamp.json'),'utf8'));
  assert.equal(stamp.schemaVersion,1);assert.deepEqual(stamp.inputs,clauseWord2Inputs());
  for(const row of stamp.outputs)assert.equal(fileHash(path.join(clauseWord2Root,row.path)),row.sha256,'Clause-word2 output changed: '+row.path);
  return {stamp,fingerprint:sha256(JSON.stringify(stamp))};
}
