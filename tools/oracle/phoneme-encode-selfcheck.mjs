import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root, referenceBuild, fileHash, sha256 } from './trace-build-info.mjs';
import { createPhonemeTables } from '../../src/core/phoneme-table.js';
import { encodePhonemes } from '../../src/core/phoneme-encode.js';
import { createPhonemeEncodeOracle } from './phoneme-encode.mjs';
const tables=createPhonemeTables(new Uint8Array(readFileSync(path.join(referenceBuild,'espeak-ng-data/phontab')))),oracle=createPhonemeEncodeOracle();
mkdirSync(path.join(root,'artifacts'),{recursive:true});const out=mkdtempSync(path.join(root,'artifacts/oracle-phoneme-encode-'));
const sourceNames=['src/core/phoneme-encode.js','src/core/phoneme-table.js','src/core/utf8-scan.js','tools/oracle/phoneme-encode.mjs'];
const snapshot=()=>sourceNames.map(name=>({path:name,sha256:fileHash(path.join(root,name))}));const sources=snapshot();
const hex=value=>Buffer.from(value).toString('hex');
const common=['',' ','\t\r\n','|','||','|||','||||','p|t','tS','t|S',"l'et@",'_^_','_^_en','_^_EN','_^_en ','_^_FR','_^_FR p','_^_en-us','p_^_EN','_^_fr|p','_|',"'e:j",'α','😀','e\u0301','\0p'].map(bytes=>({bytesHex:hex(bytes)}));
for(let byte=0;byte<256;byte++){common.push({bytesHex:hex([byte])});common.push({bytesHex:hex([byte]),reportBadPhoneme:false});}
for(const bytes of [[0x80,0x81,0x70],[0xc0,0x80],[0xe4,0xb8],[0xf0,0x9f,0x98],[0xff,0x70],[0x15,0x65,0x6e]])common.push({bytesHex:hex(bytes)});
for(const offset of [0,1,2,3,4,5,6,7,8])common.push({bytesHex:hex('\0\0\0p|t t'),offset});
let random=0x5eed454e;const next=()=>{random^=random<<13;random^=random>>>17;random^=random<<5;return random>>>0;};
for(let i=0;i<256;i++){const bytes=Uint8Array.from({length:next()%48},()=>next()&255);common.push({bytesHex:hex(bytes),offset:bytes.length?next()%(bytes.length+1):0,reportBadPhoneme:i%4!==0});}
const evidence=[];let active=null,total=0;
try{
  for(const table of tables.tables){
    const selected=tables.select(table.index),rows=[...common];
    for(const ph of selected.entries){if(!ph)continue;let name=[],mnemonic=ph.mnemonic;while(mnemonic&255){name.push(mnemonic&255);mnemonic>>>=8;}
      for(const bytes of [name,[32,...name], [...name,124,...name],[...name,124,124,...name],[...name,32,112],[...name,0,116]])rows.push({bytesHex:hex(bytes)});
    }
    active={index:table.index,encode:rows};const response=oracle(active);assert.deepEqual(response.result.constants,{phINVALID:15,phonSWITCH:21,defaultVoice:'en'});
    for(let i=0;i<rows.length;i++){
      const row=response.request.encode[i],result=encodePhonemes(new Uint8Array(Buffer.from(row.bytesHex,'hex')),selected,{offset:row.offset,reportBadPhoneme:row.reportBadPhoneme});
      active={index:table.index,row};assert.deepEqual({offset:result.offset,badPhoneme:result.badPhoneme,phonemesHex:hex(result.phonemes)},response.result.results[i]);total++;
    }
    if(table.index===80)assert.deepEqual(response,oracle(response.request));
    evidence.push({index:table.index,name:table.name,cases:rows.length,responseSha256:sha256(JSON.stringify(response))});
  }
  assert.deepEqual(snapshot(),sources);
  const report={schemaVersion:1,kind:'original-public-EncodePhonemes-vs-JS',status:'passed',reference:oracle().reference,tables:evidence.length,comparisons:total,
    compared:['phoneme bytes','absolute returned input offset','bad_phoneme with nonnull/NULL pointer'],sources,evidence,
    limitation:'C-locale byte parsing over original selected phontab tables. Correctness checks do not establish device allocation or speed budgets.'};
  writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(`PASS ${total} EncodePhonemes comparisons across ${evidence.length} original tables; ${out}/report.json`);
}catch(error){writeFileSync(path.join(out,'failure.json'),JSON.stringify({active,error:error.stack},null,2)+'\n');throw error;}
