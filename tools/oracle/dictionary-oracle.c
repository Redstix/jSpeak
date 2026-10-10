/* Development-only oracle: calls original public dictionary functions. */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <espeak-ng/espeak_ng.h>
#include <espeak-ng/speak_lib.h>
#include "translate.h"
#include "dictionary.h"
#include "readclause.h"
#include "phoneme.h"

static void check(espeak_ng_STATUS status) { if (status != ENS_OK) { fprintf(stderr,"eSpeak status %d\n",status); exit(70); } }
static void initialize(const char *path) {
    espeak_ng_InitializePath(path); check(espeak_ng_Initialize(NULL));
    check(espeak_ng_InitializeOutput(ENOUTPUT_MODE_SYNCHRONOUS,0,NULL));
    check(espeak_ng_SetVoiceByName("en-us"));
    check(espeak_ng_SetParameter(espeakRATE,175,0)); check(espeak_ng_SetParameter(espeakPITCH,50,0)); check(espeak_ng_SetParameter(espeakVOLUME,100,0));
    InitText(espeakCHARS_UTF8 | espeakPHONEMES | espeakENDPAUSE);
    espeak_ng_SetRandSeed(1);
    /* ReadClause resets this before real dictionary lookups. */
    translator->phonemes_repeat_count = 0;
}
static void hex(const char *bytes) { putchar('"'); for (;*bytes;bytes++) printf("%02x",(unsigned char)*bytes); putchar('"'); }
static uint32_t u32(const unsigned char *p) { return (uint32_t)p[0] | (uint32_t)p[1]<<8 | (uint32_t)p[2]<<16 | (uint32_t)p[3]<<24; }
static size_t input(unsigned char *bytes,size_t capacity) {
    size_t size=fread(bytes,1,capacity,stdin);
    if(ferror(stdin) || size==capacity) { fputs("Input exceeds oracle limit\n",stderr);exit(65); }
    return size;
}
static void profile(void) {
    printf("{\"voice\":\"en-us\",\"translatorName\":%d,\"dictCondition\":%u,\"transposeMin\":%d,\"transposeMax\":%d,\"textmode\":%s,\"frequentPairsPresent\":%s,\"maxWordBytes\":%d,\"maxPhonemeBytes\":%d,\"phonemeTable\":%d,\"transposeMap\":[",
           translator->translator_name,translator->dict_condition,translator->transpose_min,translator->transpose_max,translator->langopts.textmode?"true":"false",translator->frequent_pairs?"true":"false",N_WORD_BYTES,N_PHONEME_BYTES,translator->phoneme_tab_ix);
    if(translator->transpose_map) for(int i=0;i<=translator->transpose_max-translator->transpose_min;i++) printf("%s%u",i?",":"",(unsigned char)translator->transpose_map[i]);
    puts("]}");
}
static void transpose(void) {
    char word[N_WORD_BYTES+16]={0}; size_t size=input((unsigned char *)word,N_WORD_BYTES);
    (void)size;
    int original_hash=HashDictionary(word);
    int length=TransposeAlphabet(translator,word);
    printf("{\"originalHash\":%d,\"length\":%d,\"hash\":%d,\"bufferHex\":",original_hash,length,HashDictionary(word));hex(word);puts("}");
}
static void state(Translator *tr) {
    printf("{\"repeatCount\":%d,\"repeatHex\":",tr->phonemes_repeat_count);hex(tr->phonemes_repeat);
    printf(",\"skipWords\":%d}",dictionary_skipwords);
}
static void lookup(void) {
    unsigned char payload[8192]={0}; size_t size=input(payload,sizeof(payload)-1);
    if(size<72 || u32(payload)!=0x3244494a) {fputs("Bad lookup request header\n",stderr);exit(65);}
    uint32_t length=u32(payload+4), repeats=u32(payload+8), end_flags=u32(payload+12), wflags=u32(payload+16), flags0=u32(payload+20),flags1=u32(payload+24);
    uint32_t count=u32(payload+68);
    if(length>4096 || count>300 || size!=72+length+8*count || repeats<1 || repeats>16 || u32(payload+56)>length || u32(payload+60)>1 || u32(payload+64)>1) {fputs("Invalid lookup request\n",stderr);exit(65);}
    char text[4096+512]={0}; text[1]=text[2]=' '; memcpy(text+3,payload+72,length);
    translator->dict_condition=u32(payload+28);
    translator->expect_verb=u32(payload+32); translator->expect_verb_s=u32(payload+36); translator->expect_noun=u32(payload+40); translator->expect_past=u32(payload+44);
    translator->prev_dict_flags[0]=u32(payload+48); translator->clause_terminator=u32(payload+52); translator->clause_end=text+3+u32(payload+56);
    WORD_TAB wtab[300]={0};wtab[0].flags=wflags;wtab[0].length=1;
    for(uint32_t i=0;i<count;i++) {
        const unsigned char *entry=payload+72+length+8*i;
        if(u32(entry+4)>255) {fputs("Invalid word length\n",stderr);exit(65);}
        wtab[i].flags=u32(entry);wtab[i].length=u32(entry+4);
    }
    Translator secondary=*translator;
    Translator *tr=u32(payload+64)?translator:&secondary;
    putchar('[');
    for(uint32_t i=0;i<repeats;i++) {
        char phonemes[N_WORD_PHONEMES]={0}; char *word=text+3; unsigned int flags[2]={flags0,flags1};
        printf("%s{\"stateBefore\":",i?",":"");state(tr);
        int found=LookupDictList(tr,&word,phonemes,flags,end_flags,(count || u32(payload+60))?wtab:NULL,count?count:(u32(payload+60)?1:0));
        printf(",\"found\":%d,\"flags\":[%u,%u],\"phonemesHex\":",found,flags[0],flags[1]);hex(phonemes);
        printf(",\"replacement\":%s,\"wordHex\":",word!=text+3?"true":"false");hex(word);
        fputs(",\"stateAfter\":",stdout);state(tr);putchar('}');
    }
    puts("]");
}
int main(int argc,char **argv) {
    if(argc!=3) {fputs("Usage: dictionary-oracle profile|transpose|lookup DATA\n",stderr);return 64;}
    initialize(argv[2]);
    if(!strcmp(argv[1],"profile")) profile();
    else if(!strcmp(argv[1],"transpose")) transpose();
    else if(!strcmp(argv[1],"lookup")) lookup();
    else {fputs("Unknown dictionary operation\n",stderr);return 64;}
    check(espeak_ng_Terminate()); return fflush(stdout)==0 ? 0:74;
}
