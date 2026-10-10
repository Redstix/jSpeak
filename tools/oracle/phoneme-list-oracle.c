/* Observation-only hook around the real TranslateWord2 list-building tail. */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <espeak-ng/espeak_ng.h>
#include <espeak-ng/speak_lib.h>
#include "translate.h"
#include "synthesize.h"
static void m05_capture(Translator *, const char *, const WORD_TAB *, int, int, int, int, int);
#include JSPEAK_M05_SOURCE

typedef struct {
    PHONEME_LIST2 list[N_PHONEME_LIST]; unsigned commands[N_EMBEDDED_LIST];
    int count, embedded, embedded_count, end_vowel, capitals;
    unsigned previous0, previous1; bool stressed;
} Snapshot;
static Snapshot before;
static char captured_phonemes[N_WORD_PHONEMES], captured_word[512];
static int captured, captured_pause, captured_switch, captured_pitch;
static unsigned captured_flags, captured_word_flags, captured_source, captured_length;
static void snapshot(Snapshot *s, Translator *tr) {
    memcpy(s->list, ph_list2, sizeof(s->list)); memcpy(s->commands, embedded_list, sizeof(s->commands));
    s->count=n_ph_list2; s->embedded=embedded_flag; s->embedded_count=embedded_ix;
    s->previous0=(unsigned)tr->prev_dict_flags[0]; s->previous1=(unsigned)tr->prev_dict_flags[1];
    s->end_vowel=tr->end_stressed_vowel; s->stressed=any_stressed_words; s->capitals=option_capitals;
}
static void m05_capture(Translator *tr, const char *word, const WORD_TAB *wtab, int pause, int flags, int switched, int pitch, int word_flags) {
    snapshot(&before,tr); captured++;
    memcpy(captured_phonemes,word_phonemes,sizeof(captured_phonemes));
    snprintf(captured_word,sizeof(captured_word),"%s",word);
    captured_pause=pause; captured_flags=(unsigned)flags; captured_switch=switched; captured_pitch=pitch;
    captured_word_flags=(unsigned)word_flags; captured_source=wtab->sourceix; captured_length=wtab->length;
}
static void hex(const char *s) { putchar('"'); for (; *s; s++) printf("%02x",(unsigned char)*s); putchar('"'); }
static void emit_snapshot(const Snapshot *s) {
    printf("{\"list\":{\"length\":%d",s->count);
#define EMIT_COLUMN(name, field) do { fputs(",\"" name "\":[",stdout); for(int i=0;i<N_PHONEME_LIST;i++)printf("%s%u",i?",":"",(unsigned)s->list[i].field);putchar(']'); }while(0)
    EMIT_COLUMN("phcode",phcode);EMIT_COLUMN("stresslevel",stresslevel);EMIT_COLUMN("wordstress",wordstress);
    EMIT_COLUMN("tonePh",tone_ph);EMIT_COLUMN("sourceix",sourceix);EMIT_COLUMN("synthflags",synthflags);
#undef EMIT_COLUMN
    printf("},\"state\":{\"embeddedFlag\":%d,\"embeddedIndex\":%d,\"prevDictFlags0\":%u,\"prevDictFlags1\":%u,\"endStressedVowel\":%d,\"anyStressedWords\":%s,\"optionCapitals\":%d,\"embeddedList\":[",s->embedded,s->embedded_count,s->previous0,s->previous1,s->end_vowel,s->stressed?"true":"false",s->capitals);
    for(int i=0;i<N_EMBEDDED_LIST;i++)printf("%s%u",i?",":"",s->commands[i]);
    fputs("]}}",stdout);
}
static void status(espeak_ng_STATUS value){if(value!=ENS_OK)exit(70);}
static int digit(char c){if(c>='0'&&c<='9')return c-'0';if(c>='a'&&c<='f')return c-'a'+10;return -1;}
static void profile(void) {
    printf("{\"voice\":\"en-us\",\"translatorName\":%u,\"phonemeTable\":%d,\"capacity\":%d,\"embeddedCapacity\":%d,\"phonemeCapacity\":%d,\"constants\":{",(unsigned)translator->translator_name,translator->phoneme_tab_ix,N_PHONEME_LIST,N_EMBEDDED_LIST,N_WORD_PHONEMES);
#define CONSTANT(name) printf("\"" #name "\":%u,",(unsigned)name)
    CONSTANT(phonPAUSE);CONSTANT(phonPAUSE_SHORT);CONSTANT(phonPAUSE_NOLINK);CONSTANT(phonPAUSE_VSHORT);CONSTANT(phonPAUSE_CLAUSE);CONSTANT(phonCAPITAL);
    CONSTANT(phonSWITCH);CONSTANT(phonSYLLABIC);CONSTANT(phonLENGTHEN);CONSTANT(phonEND_WORD);CONSTANT(phonX1);
    CONSTANT(SFLAG_EMBEDDED);CONSTANT(SFLAG_SYLLABLE);CONSTANT(SFLAG_LENGTHEN);CONSTANT(SFLAG_DICTIONARY);CONSTANT(SFLAG_PROMOTE_STRESS);
#undef CONSTANT
    printf("\"EMBED_P\":%u}}",(unsigned)EMBED_P);
}
int main(int argc,char **argv) {
    if(argc!=2)return 64;
    espeak_ng_InitializePath(argv[1]);status(espeak_ng_Initialize(NULL));status(espeak_ng_InitializeOutput(ENOUTPUT_MODE_SYNCHRONOUS,0,NULL));status(espeak_ng_SetVoiceByName("en-us"));
    fputs("{\"profile\":",stdout);profile();fputs(",\"results\":[",stdout);
    char line[2048],encoded[1000];unsigned row=0;
    while(fgets(line,sizeof(line),stdin)) {
        unsigned word_flags,previous0,previous1,source_index,word_length;int pause,count,seed,capitals,embedded,command_count,end_vowel,stressed,operation,used=0;
        if(sscanf(line,"%u %d %d %d %d %d %d %u %u %d %d %u %u %999s %d %n",&word_flags,&pause,&count,&seed,&capitals,&embedded,&command_count,&previous0,&previous1,&end_vowel,&stressed,&source_index,&word_length,encoded,&operation,&used)!=15||line[used])return 65;
        size_t length=strcmp(encoded,"-")?strlen(encoded)/2:0;
        if(strlen(encoded)%2&&strcmp(encoded,"-"))return 65;
        if(length>199||count<1||count>N_PHONEME_LIST||seed<0||seed>1||command_count<0||command_count>N_EMBEDDED_LIST-7||word_length>255||++row>16384||operation<0||operation>3)return 65;
        if((operation==0&&(count>=N_PHONEME_LIST-9||source_index>65535))||(operation==2&&count>N_PHONEME_LIST-2))return 65;
        if(word_flags&FLAG_EMBEDDED)return 65; /* command parsing is before this observed boundary */
        InitText(espeakCHARS_UTF8|espeakPHONEMES|espeakENDPAUSE);SelectPhonemeTable(80);
        char word[544]={0};word[1]=word[2]=' ';
        for(size_t i=0;i<length;i++){int a=digit(encoded[i*2]),b=digit(encoded[i*2+1]);if(a<0||b<0)return 65;word[3+i]=(char)(a*16+b);}
        if(memchr(word+3,0,length))return 65;
        word[3+length]=' ';
        memset(ph_list2,0,sizeof(ph_list2));
        if(seed)for(int i=0;i<N_PHONEME_LIST;i++){ph_list2[i].phcode=phonPAUSE_SHORT;ph_list2[i].stresslevel=17;ph_list2[i].wordstress=(unsigned char)i;ph_list2[i].tone_ph=2;ph_list2[i].sourceix=(unsigned short)i;ph_list2[i].synthflags=0x1234;}
        for(int i=0;i<count;i++)ph_list2[i].phcode=phonPAUSE_SHORT;
        n_ph_list2=count;embedded_flag=embedded;embedded_ix=command_count;embedded_read=0;
        for(int i=0;i<N_EMBEDDED_LIST;i++)embedded_list[i]=i<(int)command_count?0x81:0;
        any_stressed_words=stressed!=0;option_capitals=capitals;option_sayas=0;option_emphasis=0;
        translator->prev_dict_flags[0]=(int)previous0;translator->prev_dict_flags[1]=(int)previous1;translator->end_stressed_vowel=end_vowel;translator->prepause_timeout=0;
        translator->expect_verb=translator->expect_verb_s=translator->expect_noun=translator->expect_past=0;translator->prev_last_stress=0;translator->dict_condition=72;
        translator->clause_end=word+3+length;dictionary_skipwords=0;translator->phonemes_repeat_count=0;translator->phonemes_repeat[0]=0;
        WORD_TAB words[3]={{0}};words[1].flags=word_flags;words[1].sourceix=source_index;words[1].length=word_length;
        if(operation) {
            snapshot(&before,translator);
            if(operation==1){words[1].flags|=FLAG_DELETE_WORD;TranslateWord2(translator,word+3,&words[1],1,pause);}
            else if(operation==2)m05_finish_clause(source_index);
            else m05_begin_clause(translator);
            Snapshot after;snapshot(&after,translator);
            if(row>1)putchar(',');
            printf("{\"operation\":%d,\"before\":",operation);emit_snapshot(&before);fputs(",\"after\":",stdout);emit_snapshot(&after);putchar('}');continue;
        }
        captured=0;unsigned flags=(unsigned)TranslateWord2(translator,word+3,&words[1],1,pause);Snapshot after;snapshot(&after,translator);
        if(row>1)putchar(',');
        printf("{\"captured\":%d,\"flags\":%u",captured,flags);
        if(captured){fputs(",\"phonemesHex\":",stdout);hex(captured_phonemes);fputs(",\"wordHex\":",stdout);hex(captured_word);
            printf(",\"options\":{\"dictionaryFlags\":%u,\"wordFlags\":%u,\"sourceIndex\":%u,\"wordLength\":%u,\"prePause\":%d,\"switchPhonemes\":%d,\"pitchRaised\":%d},\"before\":",captured_flags,captured_word_flags,captured_source,captured_length,captured_pause,captured_switch,captured_pitch);emit_snapshot(&before);
        }
        fputs(",\"after\":",stdout);emit_snapshot(&after);putchar('}');
    }
    if(ferror(stdin))return 74;
    puts("]}");espeak_ng_Terminate();return 0;
}
