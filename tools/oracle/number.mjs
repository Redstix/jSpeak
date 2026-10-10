import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { config, referenceBuild } from './trace-build-info.mjs';
import { normalizeWordRequest, wordStateFields } from './word.mjs';
import { numberBinary, numberCleanBinary, validateNumberBuild } from './number-build-info.mjs';
export const numberStateFields = ['speakMissingThousands', 'numberControl', 'nDigitLookup'];
export function normalizeNumberRequest(value) {
  const allowed = ['operation','utf8Hex','prefixHex','words','remaining','capacity','control','flags','initialPhonemesHex','state','numberState'];
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected number request');
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error('Unknown number field: ' + key);
  const operation = value.operation ?? 'number'; if (!['number','roman'].includes(operation)) throw new Error('Unknown number operation');
  const prefixHex = value.prefixHex ?? '002020';
  if (typeof prefixHex !== 'string' || !/^[0-9a-f]{6}$/.test(prefixHex)) throw new Error('Expected three prefix bytes');
  const word = normalizeWordRequest({ utf8Hex:value.utf8Hex,prefixHex:prefixHex.slice(2),words:value.words,remaining:value.remaining,state:value.state });
  if (!word.words.length) throw new Error('Number calls require a WORD_TAB');
  const capacity=value.capacity??200,control=value.control??0,flags=value.flags??[0,0],initialPhonemesHex=value.initialPhonemesHex??'';
  if (!Number.isInteger(capacity)||capacity<200||capacity>1024||!Number.isInteger(control)||control<0||control>0x7fffffff) throw new Error('Invalid number capacity/control');
  if (!Array.isArray(flags)||flags.length!==2||flags.some(v=>!Number.isInteger(v)||v<0||v>0xffffffff)) throw new Error('Invalid flags');
  if (typeof initialPhonemesHex!=='string'||!/^(?:[0-9a-f]{2})*$/.test(initialPhonemesHex)||initialPhonemesHex.length/2>=capacity) throw new Error('Invalid initial phonemes');
  if(value.numberState!==undefined&&(!value.numberState||typeof value.numberState!=='object'||Array.isArray(value.numberState)))throw new Error('Expected numeric state object');
  const numberState={speakMissingThousands:0,numberControl:0,nDigitLookup:0,ordinal2Hex:'',ordinal2xHex:'',...value.numberState};
  for (const [key,v] of Object.entries(numberState)) {
    if(numberStateFields.includes(key)){if(!Number.isInteger(v)||v< -0x80000000||v>0x7fffffff)throw new Error('Invalid numeric state');}
    else if(['ordinal2Hex','ordinal2xHex'].includes(key)){if(typeof v!=='string'||!/^(?:[0-9a-f]{2})*$/.test(v)||v.length>22)throw new Error('Invalid ordinal state');}
    else throw new Error('Unknown numeric state');
  }
  return {operation,utf8Hex:word.utf8Hex,prefixHex,words:word.words,remaining:word.remaining,capacity,control,flags:[...flags],initialPhonemesHex,state:word.state,numberState};
}
export function createNumberOracle({ clean = false } = {}) {
  const build=validateNumberBuild();
  const run=(operation,input=Buffer.alloc(0))=>JSON.parse(execFileSync(clean ? numberCleanBinary : numberBinary,[operation,referenceBuild],{input,timeout:30000,maxBuffer:16*1024*1024,env:{...process.env,LC_ALL:'C',JSPEAK_TRACE_FILE:'',JSPEAK_WORD_TRACE_FILE:''}}));
  const reference={upstreamCommit:config.commit,helperFingerprint:build.fingerprint,dataFingerprint:build.stamp.inputs.reference.dataFingerprint,profile:'direct-number-en-us-v1'};
  return value=>{
    const q=normalizeNumberRequest(value),n=q.numberState;
    if(clean&&(numberStateFields.some(k=>n[k]!==0)||n.ordinal2Hex||n.ordinal2xHex))throw new Error('Clean public helper does not expose static number state');
    const values=[q.utf8Hex.length/2,q.words.length,q.remaining,q.capacity,q.control,...q.flags,q.initialPhonemesHex.length/2,q.state.repeatHex.length/2,n.ordinal2Hex.length/2,n.ordinal2xHex.length/2,...numberStateFields.map(k=>n[k]),...wordStateFields.map(k=>q.state[k])];
    const header=Buffer.alloc(values.length*4);values.forEach((v,i)=>header.writeUInt32LE(v>>>0,i*4));
    const words=Buffer.alloc(q.words.length*20);q.words.forEach((w,i)=>['flags','start','prePause','sourceix','length'].forEach((k,j)=>words.writeUInt32LE(w[k],i*20+j*4)));
    const input=Buffer.concat([header,...[q.prefixHex,q.utf8Hex,q.initialPhonemesHex,q.state.repeatHex,n.ordinal2Hex,n.ordinal2xHex].map(s=>Buffer.from(s,'hex')),words]);
    return {schemaVersion:1,reference:structuredClone(reference),request:q,result:run(q.operation,input)};
  };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{const input=readFileSync(0);if(input.length>8*1024*1024)throw new Error('Number JSON exceeds 8 MiB');
    const value=JSON.parse(input),oracle=createNumberOracle();if(Array.isArray(value)&&value.length>1024)throw new Error('Number batch exceeds 1024 requests');
    console.log(JSON.stringify(Array.isArray(value)?value.map(oracle):oracle(value)));
  }catch(error){console.error(JSON.stringify({error:error.message}));process.exitCode=2;}
}
