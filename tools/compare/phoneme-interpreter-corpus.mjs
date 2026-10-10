export function interpreterCorpus(tables){
  const selected=tables.select(80),entries=selected.entries,all=entries.filter(Boolean),vowels=all.filter(ph=>ph.type===2),cases=[];
  const vowel=vowels[0].code,consonant=all.find(ph=>ph.type===4).code;
  function make(code,{prev=9,next=9,stress=4,control=0,translator=true,reduce=0,boundary=true,wordData=true}={}){
    const list=Array.from({length:8},(_,i)=>({phcode:9,phonemeId:10,type:0,sourceix:i===0||i===7?1:0,stdLength:181,phontabAddr:123456,soundParam:-456}));
    for(const [index,phcode] of [[2,prev],[3,code],[4,next]])list[index]={...list[index],phcode,phonemeId:phcode+1,type:entries[phcode].type,stresslevel:stress,wordstress:4};
    list[1].sourceix=1;list[4].sourceix=boundary?1:0;
    return {table:80,list,index:3,control,translator,reduce,wordData,prevVowel:{phcode:vowel,phonemeId:vowel+1,type:2,stresslevel:4,wordstress:4,sourceix:1,stdLength:72}};
  }
  const neighbors=[9,consonant,...[...new Set(vowels.map(ph=>ph.startType))].map(type=>vowels.find(ph=>ph.startType===type).code)];
  for(const ph of all)for(const neighbor of neighbors)for(const control of [0,256])for(const stress of [0,4]){
    cases.push({id:`real-${ph.code}-${neighbor}-${control}-${stress}`,request:make(ph.code,{prev:neighbor,next:neighbor,control,stress,boundary:false})});
  }
  for(const ph of all)for(const options of [{translator:false},{control:1},{control:257,reduce:3,stress:1},{stress:2},{wordData:false}])cases.push({id:`context-${ph.code}-${JSON.stringify(options)}`,request:make(ph.code,{prev:vowel,next:vowel,boundary:false,...options})});
  for(const ph of all)for(const flags of [16,0x2000,0xffff])for(const reduce of [0,3]){
    const request=make(ph.code,{prev:vowel,next:vowel,boundary:false,reduce,stress:1,control:256});
    request.list[3].synthflags=flags;request.list[3].sourceix=flags===16?1:0;request.list[3].tonePh=vowel;request.list[3].tonePhId=vowel+1;
    cases.push({id:`flags-${ph.code}-${flags}-${reduce}`,request});
  }
  function custom(id,words,options={}){cases.push({id:'instruction-'+id,request:{...make(vowel,options),program:[0,...words]}});}
  custom('return',[1]);custom('continue',[2,0xa7f,1]);
  for(let param=1;param<16;param++){if(param===5||param===12||param===13)continue;custom('param-'+param,[(param<<8)|219,1]);}
  custom('append-vowel',[0x0555,1],{next:vowel});custom('append-consonant',[0x0555,1],{next:consonant});
  for(const value of [0,1,127,128,255])custom('add-length-'+value,[0xc00|value,1]);
  for(const length of [0,1,2,3,15,16])custom('ipa-'+length,[0xd00|length,...Array.from({length:Math.ceil(length/2)},(_,i)=>0xc2a0+i),1]);
  for(let stressCondition=0;stressCondition<=4;stressCondition++)for(const stress of [0,1,2,3,4,5])for(const reduce of [0,2])custom(`changeif-${stressCondition}-${stress}-${reduce}`,[0x1000|(stressCondition<<8)|consonant,0xa40,1],{stress,reduce});
  custom('change-pass',[0x0155,0xa40,1],{control:256});custom('change-synthesis',[0x0155,0xa40,1]);
  for(const kind of [0x9200,0x9300])custom('envelope-'+kind,[kind|15,0xffff,1]);
  for(const kind of [0xa100,0xa200])custom('transition-'+kind,[kind|255,0xffff,0xffff,0xffff,1]);
  for(let kind=11;kind<=15;kind++)for(const param of [0,127,128,255])custom(`sound-${kind}-${param}`,[(kind<<12)|(param<<4)|15,0xffff,1]);
  custom('fmt-addwav',[0xb210,0x1234,0xf340,0x5678,1]);custom('wav-addwav',[0xc210,0x1234,0xf340,0x5678,1]);
  custom('fmt-continue',[0xb210,0x1234,2,0xa22,1]);custom('vowelstart-continue',[0xdff0,0x1234,2,1]);
  custom('call',[0x9100,5,0xa22,1,0xa33,1]);
  custom('call-stack-full',[0x9100,1,1]);
  custom('jump',[0x6002,0xa33,0xa22,1]);custom('jump-false',[0x2f03,0x6803,0xa33,0xa44,0xa22,1]);
  for(const which of [0,1,2,3,4,5,6,7,8,9,10]){
    const prefix=which<6?[(0x2000|(which<<8)|vowel)]:[0x2600|vowel,which];
    custom('exact-neighbor-'+which,[...prefix,0xa22,1],{prev:vowel,next:vowel,boundary:false});
    for(const other of [0,1,2,3,4,9,10,11,12,13,14,16,17,18,19]){
      if(which===8&&[9,11,13,14,19].includes(other))continue; // pointer-only prev_vowel has no neighboring array.
      const instruction=0x2080|other|((7+(which<6?which:6))<<8);
      custom(`other-${which}-${other}`,[instruction,...(which<6?[]:[which]),0xa22,1],{prev:vowel,next:vowel,boundary:false});
    }
  }
  for(const mask of [0,0x20,0x40])for(let value=0;value<32;value++)custom(`property-${mask}-${value}`,[0x2800|mask|value,0xa22,1]);
  for(const code of [1,2,3,4])for(const control of [0,1])custom(`other-global-${code}-${control}`,[0x2f00|code,0xa22,1],{control});
  custom('not',[0x2f03,3,0xa22,1]);custom('or',[0x3f03,0x2f01,0xa22,1],{control:1});custom('and',[0x2f01,0x2f03,0xa22,1],{control:1});
  for(const [name,words] of [['ipa',[0xd03,0x6162,0x6300]],['call',[0x9100,1]],['transition',[0xa100,0x1234,0xabcd,0xffff]],['fmt',[0xb000,4]],['fmt-addwav',[0xb000,4,0xf000,8]],['wav-continue',[0xc000,4,2]]])custom('skip-'+name,[0x2f03,...words,0xa22,1]);
  for(const start of [0,2,3])for(const which of [0,5,10]){
    const request=make(vowel,{prev:vowel,next:vowel,boundary:false,control:256});request.start=start;
    request.program=[0,...(which<6?[0x2000|(which<<8)|vowel]:[0x2600|vowel,which]),0xa22,1];
    cases.push({id:`list-start-${start}-${which}`,request});
  }
  for(const flags of [0,0x2000])for(const control of [0,256])for(const which of [0,1,2]){
    const request=make(vowel,{prev:vowel,next:vowel,boundary:false,control});request.list[3].synthflags=flags;
    request.list[which===0?2:which===1?3:4].phonemeId=which===1?consonant+1:0;
    request.program=[0,0x2080|17|((7+which)<<8),0xa22,1];
    cases.push({id:`null-and-resolved-${flags}-${control}-${which}`,request});
  }
  const klatt=make(vowel);klatt.klatt=1;klatt.program=[0,0x2f02,0xa22,1];cases.push({id:'klatt-enabled',request:klatt});
  for(const kind of [0x6a00,0x6c00])for(const neighbor of neighbors)custom(`switch-${kind}-${neighbor}`,[kind,...Array.from({length:12},(_,i)=>i%2===0?0xff0+i:0x1200+i),1],{prev:neighbor,next:neighbor});
  return cases;
}
