// Fixed en-us paths of pinned numbers.c: TranslateNumber/TranslateRoman.
// GPL-3.0-or-later. Copyright (C) 2005-2015 Jonathan Duddington;
// 2015-2016, 2020 Reece H. Dunn. See licenses/espeak-ng/COPYING.txt.
import { NUMBER_PROFILE as P, NUMBER_CONSTANTS as C } from '../../data/number/profile.js';
import { DICTIONARY_CONSTANTS as D } from '../../data/dictionary/profile.js';
import { readForward } from './utf8-scan.js';
import { isAlpha } from './unicode.js';
export { NUMBER_PROFILE } from '../../data/number/profile.js';
function binary(bytes) { var s=''; for(var i=0;i<bytes.length&&bytes[i];i++)s+=String.fromCharCode(bytes[i]);return s; }
function bytes(s) { var b=new Uint8Array(s.length);for(var i=0;i<s.length;i++)b[i]=s.charCodeAt(i);return b; }
function digit(c) { return c>=48&&c<=57; }
function fail(reason) { var e=new Error('Number translation dependency: '+reason);e.code='NUMBER_UNSUPPORTED';e.reason=reason;throw e; }
var END=String.fromCharCode(C.phonEND_WORD),PAUSE=String.fromCharCode(C.phonPAUSE_NOLINK);

// Lookup side effects share the caller's dictionary session. Per-number static
// state persists until reset/setState, as it does in the original translation unit.
export function createNumberTranslation(dictionarySession, options) {
  if(!dictionarySession||typeof dictionarySession.lookup!=='function'||typeof dictionarySession.setState!=='function')throw new TypeError('Expected dictionary session');
  var opts=options||{},missing=0,numberControl=0,nDigit=0,ordinal2='',ordinal2x='',digitLookup='',context={};
  function state(){return {speakMissingThousands:missing,numberControl:numberControl,nDigitLookup:nDigit,ordinal2:bytes(ordinal2),ordinal2x:bytes(ordinal2x)};}
  function setState(s){
    if(!s||typeof s!=='object')throw new TypeError('Expected number state');
    for(var k in s)if(k==='ordinal2'||k==='ordinal2x'){if(!(s[k] instanceof Uint8Array)||s[k].length>11)throw new RangeError('Invalid ordinal buffer');}
    else if(['speakMissingThousands','numberControl','nDigitLookup'].indexOf(k)<0||!Number.isInteger(s[k])||s[k]<-2147483648||s[k]>2147483647)throw new RangeError('Invalid number state');
    if(s.speakMissingThousands!==undefined)missing=s.speakMissingThousands;
    if(s.numberControl!==undefined)numberControl=s.numberControl;
    if(s.nDigitLookup!==undefined)nDigit=s.nDigitLookup;
    if(s.ordinal2!==undefined)ordinal2=binary(s.ordinal2);
    if(s.ordinal2x!==undefined)ordinal2x=binary(s.ordinal2x);
  }
  function dictSettings(){return {dictCondition:context.dictCondition===undefined?P.dictCondition:context.dictCondition,
    expectVerb:(context.expectVerb||0)>>>0,expectVerbS:(context.expectVerbS||0)>>>0,expectNoun:(context.expectNoun||0)>>>0,expectPast:(context.expectPast||0)>>>0,
    prevDictFlags:context.prevDictFlags0||0,clauseTerminator:context.clauseTerminator||0};}
  function lookup(key){
    var input=bytes(key),result;
    if(typeof opts.lookupSymbol==='function')result=opts.lookupSymbol(input,context);
    else {
      var s=dictSettings();s.flags1=D.FLAG_LOOKUP_SYMBOL;s.endFlags=D.FLAG_ALLOW_TEXTMODE;
      result=dictionarySession.lookup(input,s);
      if(result.flags[0]&D.FLAG_TEXTMODE)fail('translate-word-textmode');
      result={flags:result.found?result.flags[0]:0,phonemes:result.phonemes};
    }
    if(!result||!(result.phonemes instanceof Uint8Array)||!Number.isInteger(result.flags))throw new TypeError('Invalid Lookup result');
    return {found:result.flags>>>0,ph:binary(result.phonemes)};
  }
  function thousands(value,plex,exact){
    var r={found:0,ph:''},foundValue=0,of='';
    if(value>0){
      if(exact&1){
        if(exact&2)r=lookup('_'+value+'M'+plex+'o');
        if(!r.found&&(numberControl&1))r=lookup('_'+value+'M'+plex+'e');
        if(!r.found)r=lookup('_'+value+'M'+plex+'x');
      }
      if(!r.found)r=lookup('_'+value+'M'+plex);
      foundValue=r.found;
    }
    if(!foundValue){
      if(value%100>=20)of=lookup('_0of').ph;
      r={found:0,ph:''};
      if(exact&1){
        if(exact&2)r=lookup('_0M'+plex+'o');
        if(!r.found&&(numberControl&1))r=lookup('_0M'+plex+'e');
        if(!r.found)r=lookup('_0M'+plex+'x');
      }
      if(!r.found){
        r=lookup('_0M'+plex);
        if(!r.found){
          if(plex>3&&!lookup('_0M'+(plex-1)).found){r=lookup('_0M2');missing=3;}
          if(!r.ph){r=lookup('_'+value+'M1');foundValue=r.found;if(!foundValue)r=lookup('_0M1');missing=2;}
        }
      }
    }
    return {found:foundValue,ph:of+r.ph};
  }
  function num2(value,plex,control){
    var units=value%10,tens=Math.floor(value/10),found=0,foundOrdinal=0,ordType=(control&32)?'q':'o',isOrdinal=control&1;
    var phOrdinal='',phTens='',phDigits='',r;
    if((control&2)&&nDigit===2)return digitLookup;
    if(!digitLookup){
      if(control&8){r=lookup('_'+value+'fx');if(!r.found)r=lookup('_'+value+'f');found=r.found;phDigits=r.ph;}
      else if(isOrdinal){
        phOrdinal=ordinal2;
        if(control&4){r=lookup('_'+value+ordType+'x');found=r.found;phDigits=r.ph;if(found&&ordinal2x)phOrdinal=ordinal2x;}
        if(!found){r=lookup('_'+value+ordType);found=r.found;phDigits=r.ph;}foundOrdinal=found;
      }
      if(!found){
        if(control&2){if(numberControl&1){r=lookup('_'+value+'e');found=r.found;phDigits=r.ph;}}
        else {r=lookup('_'+value+'a');found=r.found;phDigits=r.ph;}
        if(!found){r=lookup('_'+value);found=r.found;phDigits=r.ph;}
      }
    }
    if(value<10&&(control&16))phTens=lookup('_0').ph;
    else if(!found){
      if(isOrdinal){r=lookup('_'+tens+'X'+ordType);phTens=r.ph;if(r.found)foundOrdinal=1;}
      if(!foundOrdinal)phTens=lookup('_'+tens+((control&512)?'Xf':'X')).ph;
      phDigits='';
      if(units>0){
        found=0;
        if((control&2)&&digitLookup){phDigits=digitLookup;foundOrdinal=1;phOrdinal='';}
        else {
          if(control&8){r=lookup('_'+units+'f');found=r.found;phDigits=r.ph;}
          if(isOrdinal){r=lookup('_'+units+ordType);found=r.found;phDigits=r.ph;if(found)foundOrdinal=1;}
          if(!found){
            if((numberControl&1)&&(control&2)){r=lookup('_'+units+'e');found=r.found;phDigits=r.ph;}
            else if(!(control&2)){r=lookup('_'+units+'a');found=r.found;phDigits=r.ph;}
          }
          if(!found)phDigits=lookup('_'+units).ph;
        }
      }
    }
    if(isOrdinal&&!foundOrdinal&&!phOrdinal){if(value>=20&&value%10===0)phOrdinal=lookup('_ord20').ph;if(!phOrdinal)phOrdinal=lookup('_ord').ph;}
    return phTens+phDigits+phOrdinal;
  }
  function num3(value,suppress,plex,control){
    var ordinal=control&34,hundreds=Math.floor(value/100),tu=value%100,buf1='',buf2='',phThousands='',ph100='',phDigits='',r,found=0;
    if(hundreds>0){
      if(ordinal&&tu===0){r=lookup('_0Co');found=r.found;ph100=r.ph;}
      if(!found){if(tu===0){r=lookup('_0C0');found=r.found;ph100=r.ph;}if(!found)ph100=lookup('_0C').ph;}
      if(hundreds!==19&&hundreds>=10){
        r=thousands(Math.floor(hundreds/10),plex+1,(value%1000===0?1:0)|ordinal);
        if(!r.found)phDigits=num2(Math.floor(hundreds/10),plex,0);
        phThousands=phDigits+END+r.ph+END;hundreds%=10;if(hundreds===0)ph100='';suppress=true;control|=1;
      }
      phDigits='';
      if(hundreds>0){
        suppress=true;found=0;
        if(ordinal&&tu===0){r=lookup('_'+hundreds+'Co');found=r.found;phDigits=r.ph;}
        if(!found&&tu===0){r=lookup('_'+hundreds+'C0');found=r.found;phDigits=r.ph;}
        if(!found){r=lookup('_'+hundreds+'C');found=r.found;phDigits=r.ph;}
        if(found)ph100='';else phDigits=num2(hundreds,plex,0);
      }
      buf1=phThousands+phDigits+ph100;
    }
    var and='';if(tu>0&&(value>100||((control&1)&&plex===0)))and=lookup('_0and').ph;
    if(tu!==0||!suppress){
      var x=0;if(plex===0){x=2;if(control&1024)x|=8;if(ordinal)x=3;if(value<100&&!(control&1))x|=4;if(ordinal&32)x|=32;}
      buf2=num2(tu,plex,x|(control&256));
    }else if(ordinal2){if(buf1.charCodeAt(buf1.length-1)===C.phonPAUSE_SHORT)buf1=buf1.slice(0,-1);buf2=ordinal2;}
    return buf1+and+END+buf2;
  }
  function translate(word,offset,words,remaining,capacity,control,flags,initial,optionSayas){
    if(optionSayas===C.SAYAS_DIGITS1||(words[0].flags&C.FLAG_INDIVIDUAL_DIGITS))return {found:0,ph:initial};
    flags[0]=0;nDigit=0;digitLookup='';numberControl=control;
    var at=function(i){return word[offset+i]||0;},n=0;while(digit(at(n)))n++;
    // Original strtol accepts a sign/leading whitespace even though n_digits
    // counts only initial ASCII digits.
    var raw=binary(word.subarray(offset)),match=raw.match(/^[\t\n\v\f\r ]*[+-]?\d+/),value=match?Number(match[0]):NaN;
    if(value<0)fail('negative-source');
    if(!Number.isFinite(value)||value>2147483647)return {found:0,ph:initial};
    var previous=(n===3&&at(-2)===P.thousandsSeparator&&digit(at(-3)))?1:0;
    if(!previous)missing=0;
    ordinal2='';var zeros='',ordinal=0,ix=n,skip=0;
    if(at(ix)===46&&!digit(at(ix+1))&&!digit(at(ix+2))&&(remaining<=1||!(words[1].flags&C.FLAG_NOSPACE)))word[offset+ix]=0;
    ix++;var suffix='';if(words[0].flags&C.FLAG_HYPHEN_AFTER){suffix='-';ix++;}
    while(at(ix)&&at(ix)!==32&&ix<29)suffix+=String.fromCharCode(at(ix++));
    if(suffix&&!digit(suffix.charCodeAt(0))){var sr=lookup('_#'+suffix);ordinal2=sr.ph;if(sr.found){ordinal=2;flags[0]|=C.FLAG_SKIPWORDS;skip=1;ordinal2x=lookup('_x#'+suffix).ph;}}
    if(words[0].flags&C.FLAG_ORDINAL)ordinal=2;
    if(at(0)===48&&!previous&&at(1)!==32&&at(1)!==P.decimalSeparator){
      if(!(n===2&&at(3)===58&&digit(at(5))&&[9,10,11,12,13,32].indexOf(at(7))>=0)){
        if(n>3){flags[0]=(flags[0]&~C.FLAG_SKIPWORDS)>>>0;return {found:0,ph:initial};}
        for(ix=0;at(ix)===48&&ix<n-1;ix++)zeros+=lookup('_0').ph;
      }
    }
    var inc=at(n)===P.thousandsSeparator?2:0,plex=0,exact=1;
    if(inc){var di=n+inc;while(plex+1<remaining&&!(words[plex+1].flags&C.FLAG_MULTIPLE_SPACES)&&digit(at(di))&&digit(at(di+1))&&digit(at(di+2))&&!digit(at(di+3))&&!digit(at(di-1))){
      for(ix=0;ix<3;ix++)if(at(di+ix)!==48){exact=0;break;}
      plex++;di+=3;if(at(di)===P.thousandsSeparator)di+=inc;else break;
    }}
    var suppress=value===0&&!!previous,append='',decimal=0,r;
    if(at(n)===P.decimalSeparator&&digit(at(n+1))){append=lookup('_dpt').ph;decimal=256;}
    else if(!suppress){if(inc&&plex>0){r=thousands(value,plex,exact);append=r.ph;if(r.found){value=0;suppress=true;}}}
    else if(missing===1){if(!lookup('_0M'+(plex+1)).found)append=lookup('_0M'+plex).ph;}
    if(!append&&at(n)===46&&plex===0)append=lookup('_.').ph;
    if(plex===0){
      var p=0;while(digit(at(p+1)))p++;
      function list(pos){var s=dictSettings();s.flags0=flags[0];s.flags1=flags[1];s.endFlags=C.FLAG_SUFX;s.words=words.slice(0,remaining);s.withWord=1;s.wordFlags=words[0].flags;
        if(context.clauseEndRelation!==undefined)s.clauseEndRelation=context.clauseEndRelation;
        s.clauseEnd=Math.max(0,Math.min(word.length-offset-pos,(context.clauseEnd===undefined?raw.length-1:context.clauseEnd)-pos));
        var result=dictionarySession.lookup(word.subarray(offset+pos),s);flags[0]=result.flags[0];flags[1]=result.flags[1];digitLookup=binary(result.phonemes);return result.found;}
      if(digit(at(p-1))&&list(p-1))nDigit=2;
      if(!digitLookup&&at(p)!==48&&list(p))nDigit=1;
      if(!previous&&!decimal&&!ordinal){r=lookup('_'+value+'n');if(r.found)return {found:1,ph:r.ph};}
    }
    var ph=zeros+num3(value,suppress,plex,previous|ordinal|decimal)+END+append;
    if(ph.length>=capacity)fail('original-initial-buffer-overflow');
    var stop=false,c=0;
    while(decimal&&!stop){
      n++;
      while(digit(c=at(n))&&ph.length<190){var v=at(n++)-48,part=num2(v,0,2);if(ph.length+1+part.length+1>capacity){stop=true;break;}ph+=END+part;}
      if(stop)break;
      r=lookup('_dpt2');if(r.found){if(ph.length+r.ph.length+1>capacity){stop=true;break;}ph+=r.ph;}
      if(c===P.decimalSeparator&&digit(at(n+1))){r=lookup('_dpt');if(ph.length+r.ph.length+1>capacity){stop=true;break;}ph+=r.ph;}else decimal=0;
    }
    if(ph&&ph.charCodeAt(0)!==C.phonSWITCH){var next=readForward(word,offset+n+1).codepoint;if(!isAlpha(next)&&!exact){if(ph.length+2>capacity)ph=ph.slice(0,capacity-2);ph+=PAUSE;}}
    flags[0]=(flags[0]|C.FLAG_FOUND)>>>0;missing=(missing-1)|0;if(skip)dictionarySession.setState({skipWords:skip});return {found:1,ph:ph};
  }
  function run(input,settings,roman){
    if(!(input instanceof Uint8Array))throw new TypeError('Expected number bytes');var s=settings||{},offset=s.offset===undefined?3:s.offset,capacity=s.capacity===undefined?200:s.capacity;
    if(!Number.isInteger(offset)||offset<3||offset>=input.length||!Number.isInteger(capacity)||capacity<200||capacity>1024)throw new RangeError('Invalid number offset/capacity');
    var words=(s.words||[{}]).map(function(w){return {flags:(w.flags||0)>>>0,start:w.start||0,prePause:w.prePause||0,sourceix:w.sourceix||0,length:w.length||0};});
    var remaining=s.remaining===undefined?words.length:s.remaining;if(!words.length||!Number.isInteger(remaining)||remaining<0||remaining>words.length)throw new RangeError('Invalid WORD_TAB');
    var word=new Uint8Array(input.length+512);word.set(input);context=Object.assign({},s.dictionaryContext||{});
    var flags=new Uint32Array(s.flags||[0,0]),initial=binary(s.initialPhonemes||new Uint8Array(0)),before=state(),result;
    if(roman){
      var acc=0,prev=0,subtract=32767,repeat=0,p=offset,valid=true;
      if(digit(word[offset-2])||word[offset+1]===32)valid=false;
      while(valid&&word[p]!==32&&word[p]){
        var c=word[p++],index='ixcmvld'.indexOf(String.fromCharCode(c));if(index<0){valid=false;break;}
        var value=[1,10,100,1000,5,50,500][index];if(value===prev){if(++repeat>=3){valid=false;break;}}else repeat=0;
        if(prev>1&&prev!==10&&prev!==100&&value>=prev){valid=false;break;}
        if(prev&&prev<value){if(acc%10!==0||prev*10<value){valid=false;break;}subtract=prev;value-=subtract;}
        else if(value>=subtract){valid=false;break;}else acc+=prev;prev=value;
      }
      if(valid){p++;acc+=prev;if(digit(word[p])||acc<P.minRoman||acc>P.maxRoman)valid=false;}
      result={found:0,ph:''};
      if(valid){
        var romanPh=lookup('_roman').ph;result.ph=romanPh;
        if(word[p]!==46){context.prevDictFlags0=context.prevDictFlags1=0;var numeric=bytes('  '+acc+'     '),padded=new Uint8Array(numeric.length+512);padded.set(numeric);
          var temporaryFlags=new Uint32Array(2),nr=translate(padded,2,words,remaining,capacity-romanPh.length,0,temporaryFlags,'',s.optionSayas||0);result={found:1,ph:romanPh+nr.ph};}
      }
    }else result=translate(word,offset,words,remaining,capacity,s.control||0,flags,initial,s.optionSayas||0);
    return {found:result.found,phonemes:bytes(result.ph),flags:flags,buffer:word.slice(0,input.length),words:words,
      stateBefore:before,stateAfter:state(),dictionaryState:dictionarySession.state(),prevDictFlags0:(context.prevDictFlags0||0)>>>0,prevDictFlags1:(context.prevDictFlags1||0)>>>0};
  }
  return {number:function(input,settings){return run(input,settings,false);},roman:function(input,settings){return run(input,settings,true);},state:state,setState:setState};
}
