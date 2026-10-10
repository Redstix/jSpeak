/* Direct original InterpretPhoneme: input/state setup and complete serialization only. */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <espeak-ng/espeak_ng.h>
#include <espeak-ng/speak_lib.h>
#include "translate.h"
#include "synthesize.h"
#include "synthdata.h"
#include "voice.h"
#ifndef JSPEAK_CLEAN
#include JSPEAK_SYNTHDATA_SOURCE
#endif
static void check(espeak_ng_STATUS s){if(s!=ENS_OK)exit(70);}
static uint32_t u32(void){unsigned char b[4];if(fread(b,1,4,stdin)!=4)exit(65);return (uint32_t)b[0]|(uint32_t)b[1]<<8|(uint32_t)b[2]<<16|(uint32_t)b[3]<<24;}
/* Keep this order identical to the documented wire schema, not native struct layout. */
#define FIELDS(X) X(synthflags,synthflags,65535) X(phcode,phcode,255) X(stresslevel,stresslevel,255) X(sourceix,sourceix,65535) X(wordstress,wordstress,255) X(tonePh,tone_ph,255) X(length,length,0xffffffffU) X(env,env,255) X(type,type,255) X(prepause,prepause,255) X(amp,amp,255) X(newword,newword,255) X(pitch1,pitch1,255) X(pitch2,pitch2,255) X(stdLength,std_length,255) X(phontabAddr,phontab_addr,0xffffffffU)
static void read_row(PHONEME_LIST *p){
    memset(p,0,sizeof(*p));
#define READ(name,field,max) do{uint32_t x=u32();if(x>max)exit(65);p->field=x;}while(0);
    FIELDS(READ)
#undef READ
    p->sound_param=(int32_t)u32();unsigned id=u32(),tone=u32();if(id>256||tone>256)exit(65);
    p->ph=id?phoneme_tab[id-1]:NULL;p->tone_ph_data=tone?phoneme_tab[tone-1]:NULL;
    if((id&&!p->ph)||(tone&&!p->tone_ph_data))exit(65);
}
static void emit_row(const PHONEME_LIST *p){
    putchar('{');
#define EMIT(name,field,max) printf("\"" #name "\":%u,",(unsigned)p->field);
    FIELDS(EMIT)
#undef EMIT
    printf("\"soundParam\":%d,\"phonemeId\":%u,\"tonePhId\":%u}",p->sound_param,p->ph?(unsigned)p->ph->code+1:0,p->tone_ph_data?(unsigned)p->tone_ph_data->code+1:0);
}
static void ints(const int *p,int size){putchar('[');for(int i=0;i<size;i++)printf("%s%d",i?",":"",p[i]);putchar(']');}
static void emit_data(const PHONEME_DATA *p){
    printf("{\"control\":%d,\"param\":",p->pd_control);ints(p->pd_param,16);fputs(",\"soundAddr\":",stdout);ints(p->sound_addr,5);
    fputs(",\"soundParam\":",stdout);ints(p->sound_param,5);fputs(",\"vowelTransition\":",stdout);ints(p->vowel_transition,4);
    printf(",\"pitchEnv\":%d,\"ampEnv\":%d,\"ipa\":[",p->pitch_env,p->amp_env);
    for(int i=0;i<18;i++)printf("%s%u",i?",":"",(unsigned char)p->ipa_string[i]);
    fputs("]}",stdout);
}
int main(int argc,char **argv){
    if(argc!=2)return 64;
    espeak_ng_InitializePath(argv[1]);check(espeak_ng_Initialize(NULL));check(espeak_ng_InitializeOutput(ENOUTPUT_MODE_SYNCHRONOUS,0,NULL));check(espeak_ng_SetVoiceByName("en-us"));
    printf("{\"profile\":{\"voice\":\"en-us\",\"translatorName\":%u,\"phonemeTable\":%d,\"reduce\":%d,\"klatt\":%d,\"useKlatt\":%d,\"useMbrola\":%d},\"results\":[",(unsigned)translator->translator_name,translator->phoneme_tab_ix,translator->langopts.param[LOPT_REDUCE],voice->klattv[0],USE_KLATT,USE_MBROLA);
    unsigned cases=u32();if(cases>16384)return 65;
    for(unsigned row=0;row<cases;row++){
        unsigned table=u32(),count=u32(),index=u32(),start=u32(),control=u32(),has_tr=u32(),has_word=u32();int reduce=(int32_t)u32(),klatt=(int32_t)u32();
        if(table>=N_PHONEME_TABS||count<1||count>1001||index>=count||start>index||has_tr>1||has_word>1)return 65;
        if(!phoneme_tab_list[table].name[0])return 65;
        SelectPhonemeTable((int)table);
        PHONEME_LIST list[1001];WORD_PH_DATA worddata;
        for(unsigned i=0;i<count;i++)read_row(&list[i]);
        read_row(&worddata.prev_vowel);
        unsigned program_count=u32();if(program_count>65536)return 65;
#ifdef JSPEAK_CLEAN
        if(program_count)return 65;
#else
        unsigned short *saved_index=phoneme_index,*custom=NULL;PHONEME_TAB ph;
        if(program_count){custom=calloc(program_count,sizeof(*custom));if(!custom)return 71;for(unsigned i=0;i<program_count;i++){unsigned v=u32();if(v>65535)return 65;custom[i]=v;}phoneme_index=custom;if(!list[index].ph)return 65;ph=*list[index].ph;ph.program=1;list[index].ph=&ph;}
#endif
        translator->langopts.param[LOPT_REDUCE]=reduce;voice->klattv[0]=klatt;
        PHONEME_DATA output;memset(&output,0xa5,sizeof(output));if(!list[index].ph)return 65;
        InterpretPhoneme(has_tr?translator:NULL,(int)control,&list[index],&list[start],&output,has_word?&worddata:NULL);
        if(row)putchar(',');
        fputs("{\"data\":",stdout);emit_data(&output);fputs(",\"list\":[",stdout);
        for(unsigned i=0;i<count;i++){if(i)putchar(',');emit_row(&list[i]);}fputs("],\"prevVowel\":",stdout);if(has_word)emit_row(&worddata.prev_vowel);else fputs("null",stdout);putchar('}');
#ifndef JSPEAK_CLEAN
        phoneme_index=saved_index;free(custom);
#endif
    }
    if(fgetc(stdin)!=EOF)return 65;
    puts("]}");check(espeak_ng_Terminate());return fflush(stdout)?74:0;
}
