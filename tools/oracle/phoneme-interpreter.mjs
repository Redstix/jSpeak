import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {referenceBuild,config} from './trace-build-info.mjs';
import {interpreterBinary,interpreterCleanBinary,validateInterpreterBuild} from './phoneme-interpreter-build-info.mjs';
// Independent wire schema, in helper read_row order. No runtime implementation imports.
export const interpreterRowFields=Object.freeze(['synthflags','phcode','stresslevel','sourceix','wordstress','tonePh','length','env','type','prepause','amp','newword','pitch1','pitch2','stdLength','phontabAddr','soundParam','phonemeId','tonePhId']);
const rowWidth={synthflags:16,phcode:8,stresslevel:8,sourceix:16,wordstress:8,tonePh:8,length:32,env:8,type:8,prepause:8,amp:8,newword:8,pitch1:8,pitch2:8,stdLength:8,phontabAddr:32,soundParam:-32,phonemeId:9,tonePhId:9};
function int(v,min,max,label){if(!Number.isInteger(v)||v<min||v>max)throw new RangeError('Invalid '+label);return v;}
export function normalizeInterpreterRow(row={}){assert(row&&typeof row==='object'&&!Array.isArray(row));for(const key of Object.keys(row))assert(interpreterRowFields.includes(key),'Unknown phoneme row field '+key);return Object.fromEntries(interpreterRowFields.map(key=>{const width=rowWidth[key];return [key,int(row[key]??0,width===-32?-2147483648:0,width===9?256:width===-32?2147483647:2**width-1,key)];}));}
export function normalizeInterpreterRequest(request={}){
  const list=request.list??[];assert(Array.isArray(list)&&list.length>=1&&list.length<=1001);
  const index=int(request.index??0,0,list.length-1,'index');
  const program=request.program===undefined?null:request.program;assert(program===null||Array.isArray(program)&&program.length>=2&&program.length<=65536);
  if(program)program.forEach(v=>int(v,0,65535,'instruction word'));
  for(const key of ['translator','wordData'])if(request[key]!==undefined)assert.equal(typeof request[key],'boolean');
  return {table:int(request.table??80,0,149,'table'),index,start:int(request.start??0,0,index,'start'),control:int(request.control??0,0,4294967295,'control'),translator:request.translator??true,wordData:request.wordData??false,reduce:int(request.reduce??0,-2147483648,2147483647,'reduce'),klatt:int(request.klatt??0,-2147483648,2147483647,'klatt'),list:list.map(normalizeInterpreterRow),prevVowel:normalizeInterpreterRow(request.prevVowel),program:program&&[...program]};
}
export function createPhonemeInterpreterOracle(){
  const initial=validateInterpreterBuild(),reference={upstreamCommit:config.commit,helperFingerprint:initial.fingerprint,data:initial.stamp.inputs.data};
  return function oracle(requests=[],{clean=false}={}){
    assert.equal(validateInterpreterBuild().fingerprint,initial.fingerprint);assert(Array.isArray(requests)&&requests.length<=16384);
    const rows=requests.map(normalizeInterpreterRequest),wire=[rows.length];
    for(const row of rows){wire.push(row.table,row.list.length,row.index,row.start,row.control,+row.translator,+row.wordData,row.reduce,row.klatt);for(const item of [...row.list,row.prevVowel])for(const key of interpreterRowFields)wire.push(item[key]);wire.push(row.program?.length??0);if(row.program)wire.push(...row.program);}
    const input=Buffer.alloc(wire.length*4);wire.forEach((v,i)=>input.writeUInt32LE(v>>>0,i*4));
    const process=spawnSync(clean?interpreterCleanBinary:interpreterBinary,[path.join(referenceBuild,'espeak-ng-data')],{input,encoding:'utf8',timeout:60000,maxBuffer:256*1024*1024});
    if(process.error||process.status!==0||process.stderr)throw new Error('Original interpreter failed: '+JSON.stringify({status:process.status,signal:process.signal,error:process.error?.message,stderr:process.stderr?.slice(0,4000)}));
    const result=JSON.parse(process.stdout);
    assert.equal(result.results.length,rows.length);assert.equal(validateInterpreterBuild().fingerprint,initial.fingerprint);
    return {schemaVersion:1,reference,profile:result.profile,requests:rows,results:result.results};
  };
}
