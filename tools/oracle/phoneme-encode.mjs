import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { config, referenceBuild } from './trace-build-info.mjs';
import { encodeBinary, validateEncodeBuild } from './phoneme-encode-build-info.mjs';
export function createPhonemeEncodeOracle() {
  const build=validateEncodeBuild();
  return ({index=80,encode=[]}={})=>{
    if(!Number.isInteger(index)||index<0||index>=150||!Array.isArray(encode)||encode.length>16384)throw new Error('Invalid encoder request');
    let total=4;
    const rows=encode.map(value=>{
      const row=typeof value==='string'?{bytesHex:value}:value;
      if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('Invalid encode row');
      for(const key of Object.keys(row))if(!['bytesHex','offset','reportBadPhoneme'].includes(key))throw new Error('Unknown encode field');
      const bytesHex=row.bytesHex,offset=row.offset??0,reportBadPhoneme=row.reportBadPhoneme??true;
      if(typeof bytesHex!=='string'||!/^(?:[0-9a-f]{2})*$/.test(bytesHex)||bytesHex.length>16384||!Number.isInteger(offset)||offset<0||offset>bytesHex.length/2||typeof reportBadPhoneme!=='boolean')throw new Error('Invalid bounded encode input');
      total+=12+bytesHex.length/2;if(total>16*1024*1024)throw new Error('Encoder frame exceeds 16 MiB');
      return {bytesHex,offset,reportBadPhoneme};
    });
    const header=Buffer.alloc(4);header.writeUInt32LE(rows.length);
    const parts=[header];for(const row of rows){const bytes=Buffer.from(row.bytesHex,'hex'),h=Buffer.alloc(12);h.writeUInt32LE(bytes.length);h.writeUInt32LE(row.offset,4);h.writeUInt32LE(Number(row.reportBadPhoneme),8);parts.push(h,bytes);}
    const result=JSON.parse(execFileSync(encodeBinary,[referenceBuild,String(index)],{input:Buffer.concat(parts,total),timeout:30000,maxBuffer:32*1024*1024,env:{...process.env,LC_ALL:'C',JSPEAK_TRACE_FILE:'',JSPEAK_WORD_TRACE_FILE:''}}));
    return {schemaVersion:1,reference:{upstreamCommit:config.commit,helperFingerprint:build.fingerprint,phontabSha256:build.stamp.inputs.phontabSha256},request:{index,encode:rows},result};
  };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{const input=readFileSync(0);if(input.length>32*1024*1024)throw new Error('Encode JSON too large');console.log(JSON.stringify(createPhonemeEncodeOracle()(JSON.parse(input))));}catch(error){console.error(JSON.stringify({error:error.message}));process.exitCode=2;}}
