import test from 'node:test';
import assert from 'node:assert/strict';
import {createPhonemeInterpreter,createPhonemeListBuffer,createPhonemeData,createWordPhonemeData} from '../src/core/phoneme-interpreter.js';

function setup(words,{program=1}={}){
  const entries=new Array(256).fill(null),record=(code,type,stdLength)=>({code,type,stdLength,lengthMod:3,mnemonic:code,phflags:0,startType:type===2?28:0,endType:type===2?29:0,program:code===13?program:0});
  entries[9]=record(9,0,0);entries[13]=record(13,2,70);entries[47]=record(47,4,20);
  const bytes=new Uint8Array((words.length+1)*2),view=new DataView(bytes.buffer);words.forEach((v,i)=>view.setUint16((i+1)*2,v,true));
  const list=createPhonemeListBuffer(8);list.phcode.fill(9);list.phonemeId.fill(10);list.sourceix[0]=list.sourceix[7]=1;
  list.phcode[3]=13;list.phonemeId[3]=14;list.type[3]=2;list.wordstress[3]=4;list.stdLength[3]=201;list.phontabAddr[3]=999;list.soundParam[3]=-7;
  const wordData=createWordPhonemeData();wordData.prevVowel.phcode[0]=47;wordData.prevVowel.phonemeId[0]=48;
  return {vm:createPhonemeInterpreter(bytes,{entries,index:80}),list,wordData,bytes};
}

test('interpreter writes uint8 length after copying the original vowel row',()=>{
  const {vm,list,wordData}=setup([0xaFA,0xc7f,1]);
  const output=createPhonemeData();output.ipa.fill(255);
  assert.equal(vm.interpret(list,3,{wordData},output),output);
  assert.equal(output.param[10],377);assert.equal(list.stdLength[3],121);
  assert.equal(wordData.prevVowel.stdLength[0],201);assert.equal(wordData.prevVowel.phontabAddr[0],999);
  assert.equal(list.phontabAddr[3],0);assert.deepEqual([...output.ipa],new Array(18).fill(0));
});
test('program zero resets word start history and exits before plist writes',()=>{
  const {vm,list,wordData}=setup([1],{program:0});list.sourceix[3]=1;
  const data=vm.interpret(list,3,{wordData});
  assert.equal(data.param[10],70);assert.equal(wordData.prevVowel.phonemeId[0],0);assert.equal(wordData.prevVowel.phcode[0],47);
  assert.equal(list.stdLength[3],201);assert.equal(list.phontabAddr[3],999);
});
test('ChangeIf preserves dictionary reduction and NULL translator behavior',()=>{
  for(const [translator,reduce,change,length] of [[true,0,0,34],[true,1,47,70],[false,1,0,34]]){
    const {vm,list}=setup([0x112f,0xa22,1]);list.synthflags[3]=16;
    const data=vm.interpret(list,3,{translator,reduce});assert.equal(data.param[1],change);assert.equal(data.param[10],length);
  }
});
test('phase one re-resolves the queried neighbor and phase two uses its actual pointer',()=>{
  for(const control of [0,256]){
    const {vm,list}=setup([0x2902,0xa22,1]);list.phcode[4]=13;list.phonemeId[4]=0;
    const data=vm.interpret(list,3,{control});assert.equal(data.param[10],control?34:70);assert.equal(list.phonemeId[4],control?14:0);
  }
});
test('FMT followed by addWav returns both original addresses and parameters',()=>{
  const {vm,list}=setup([0x920f,0xffff,0xbff1,0x1234,0xfab2,0x5678,0xa22,1]);
  const data=vm.interpret(list,3,{translator:false});
  assert.equal(data.pitchEnv,1048575);assert.equal(data.soundAddr[0],(1<<18)+(0x1234<<2));assert.equal(data.soundAddr[4],(2<<18)+(0x5678<<2));
  assert.equal(data.soundParam[0],255);assert.equal(data.soundParam[4],171);assert.equal(data.param[10],70);assert.equal(list.phontabAddr[3],data.soundAddr[0]);
});
test('vowel sound parameters sign extend only without CONTINUE; IPA keeps byte order',()=>{
  for(const continuing of [false,true]){
    const {vm,list}=setup([0xd03,0xc2a0,0x6200,0xdff0,4,...(continuing?[2]:[]),1]);
    const data=vm.interpret(list,3,{});assert.deepEqual([...data.ipa.slice(0,5)],[194,160,98,0,0]);assert.equal(data.soundParam[2],continuing?255:-1);
  }
});
test('ten-entry call stack silently ignores deeper calls as the original does',()=>{
  const {vm,list}=setup([0x9100,1,1]);assert.equal(vm.interpret(list,3,{}).param[10],70);
});
test('compiled bytes are owned and caller output buffers can be reused',()=>{
  const {vm,list,bytes}=setup([0xa22,1]);bytes.fill(0);const data=createPhonemeData();
  assert.equal(vm.interpret(list,3,{},data),data);assert.equal(data.param[10],34);
  data.param.fill(-1);assert.equal(vm.interpret(list,3,{},data),data);assert.equal(data.param[3],0);
});
test('malformed bytecode and missing source neighborhoods fail explicitly',()=>{
  const short=setup([0x9200]);assert.throws(()=>short.vm.interpret(short.list,3,{}),e=>e.code==='PHONEME_INTERPRETER_UNSUPPORTED'&&e.reason==='program-bounds');
  const loop=setup([0x6000]);assert.throws(()=>loop.vm.interpret(loop.list,3,{instructionBudget:20}),e=>e.reason==='instruction-budget');
  const last=setup([0x2902,0xa22,1]);last.list.phcode[7]=13;last.list.phonemeId[7]=14;
  assert.throws(()=>last.vm.interpret(last.list,7,{}),e=>e.reason==='list-bounds');
});
