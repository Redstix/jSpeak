/* Stops original MakePhonemeList at its real pre-InterpretPhoneme boundary. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <espeak-ng/espeak_ng.h>
#include <espeak-ng/speak_lib.h>
#include "translate.h"
#include "synthesize.h"
static void prepare_capture(PHONEME_LIST *, int, int);
#include JSPEAK_PREPARE_SOURCE
static PHONEME_LIST working[N_PHONEME_LIST];
static int working_count, end_source, captured;
static void prepare_capture(PHONEME_LIST *list, int count, int end) {
    if (count < 2 || count > N_PHONEME_LIST) exit(65);
    memcpy(working,list,(size_t)count*sizeof(*list));working_count=count;end_source=end;captured++;
}
static void status(espeak_ng_STATUS value){if(value!=ENS_OK)exit(70);}
static void profile(void){
    printf("{\"voice\":\"en-us\",\"translatorName\":%u,\"phonemeTable\":%d,\"capacity\":%d,\"regressiveVoicing\":%d,\"stressFlags\":%u,\"vowelPause\":%d,\"wordGap\":%d,\"optionWordgap\":%d,\"replacements\":[",(unsigned)translator->translator_name,translator->phoneme_tab_ix,N_PHONEME_LIST,translator->langopts.param[LOPT_REGRESSIVE_VOICING],translator->langopts.stress_flags,translator->langopts.vowel_pause,translator->langopts.word_gap,option_wordgap);
    for(int i=0;i<n_replace_phonemes;i++)printf("%s{\"oldPhoneme\":%u,\"newPhoneme\":%u,\"flags\":%u}",i?",":"",replace_phonemes[i].old_ph,replace_phonemes[i].new_ph,replace_phonemes[i].type);
    printf("],\"constants\":{\"SFLAG_SWITCHED_LANG\":%u,\"SFLAG_EMBEDDED\":%u,\"SFLAG_PROMOTE_STRESS\":%u,\"phUNSTRESSED\":%u,\"phonSWITCH\":%u,\"phonPAUSE\":%u}}",SFLAG_SWITCHED_LANG,SFLAG_EMBEDDED,SFLAG_PROMOTE_STRESS,phUNSTRESSED,phonSWITCH,phonPAUSE);
}
static void emit_list2(void){
    printf("{\"length\":%d",n_ph_list2);
#define COLUMN(name,field) do{fputs(",\"" name "\":[",stdout);for(int i=0;i<N_PHONEME_LIST;i++)printf("%s%u",i?",":"",(unsigned)ph_list2[i].field);putchar(']');}while(0)
    COLUMN("phcode",phcode);COLUMN("stresslevel",stresslevel);COLUMN("wordstress",wordstress);COLUMN("tonePh",tone_ph);COLUMN("sourceix",sourceix);COLUMN("synthflags",synthflags);
#undef COLUMN
    putchar('}');
}
static void emit_working(void){
    printf("{\"count\":%d",working_count);
#define COLUMN(name,field) do{fputs(",\"" name "\":[",stdout);for(int i=0;i<working_count;i++)printf("%s%u",i?",":"",(unsigned)working[i].field);putchar(']');}while(0)
    COLUMN("phcode",phcode);COLUMN("stresslevel",stresslevel);COLUMN("wordstress",wordstress);COLUMN("tonePh",tone_ph);COLUMN("sourceix",sourceix);COLUMN("synthflags",synthflags);COLUMN("type",type);
#undef COLUMN
    fputs(",\"phonemeId\":[",stdout);for(int i=0;i<working_count;i++)printf("%s%u",i?",":"",working[i].ph?(unsigned)working[i].ph->code+1:0);fputs("]}",stdout);
}
int main(int argc,char **argv){
    if(argc!=2)return 64;
    espeak_ng_InitializePath(argv[1]);status(espeak_ng_Initialize(NULL));status(espeak_ng_InitializeOutput(ENOUTPUT_MODE_SYNCHRONOUS,0,NULL));status(espeak_ng_SetVoiceByName("en-us"));
    fputs("{\"profile\":",stdout);profile();fputs(",\"results\":[",stdout);
    unsigned row=0,count,start_sentence;int post_pause,result;
    while((result=scanf("%u %d %u",&count,&post_pause,&start_sentence))==3){
        if(count<3||count>N_PHONEME_LIST||start_sentence>1||++row>16384)return 65;
        memset(ph_list2,0,sizeof(ph_list2));
        for(unsigned i=0;i<N_PHONEME_LIST;i++){
            unsigned code,stress,wordstress,tone,source,flags;
            if(scanf("%u %u %u %u %u %u",&code,&stress,&wordstress,&tone,&source,&flags)!=6||code>255||stress>255||wordstress>255||tone>255||source>65535||flags>65535)return 65;
            ph_list2[i].phcode=code;ph_list2[i].stresslevel=stress;ph_list2[i].wordstress=wordstress;ph_list2[i].tone_ph=tone;ph_list2[i].sourceix=source;ph_list2[i].synthflags=flags;
        }
        if(ph_list2[count-1].phcode!=phonPAUSE||ph_list2[count-2].phcode!=phonPAUSE)return 65;
        n_ph_list2=count;captured=0;SelectPhonemeTable(translator->phoneme_tab_ix);MakePhonemeList(translator,post_pause,start_sentence!=0);
        if(captured!=1)return 70;
        if(row>1)putchar(',');
        fputs("{\"list2\":",stdout);emit_list2();fputs(",\"working\":",stdout);emit_working();
        printf(",\"bodyLength\":%d,\"endSourceIndex\":%d,\"selectedTableIndex\":%d}",working_count-2,end_source,translator->phoneme_tab_ix);
    }
    if(result!=EOF||ferror(stdin))return 65;
    puts("]}");espeak_ng_Terminate();return 0;
}
