/* Direct original public EncodePhonemes; initialization/serialization only. */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <espeak-ng/espeak_ng.h>
#include <espeak-ng/speak_lib.h>
#include "dictionary.h"
#include "phoneme.h"
#include "synthdata.h"
static void check(espeak_ng_STATUS s) { if (s != ENS_OK) exit(70); }
static uint32_t u32(void) { unsigned char b[4]; if (fread(b,1,4,stdin)!=4)exit(65);return (uint32_t)b[0]|(uint32_t)b[1]<<8|(uint32_t)b[2]<<16|(uint32_t)b[3]<<24; }
int main(int argc,char **argv) {
    if(argc!=3)return 64;
    char *end;long table=strtol(argv[2],&end,10);
    if(!*argv[2]||*end||table<0||table>=N_PHONEME_TABS)return 64;
    espeak_ng_InitializePath(argv[1]);check(espeak_ng_Initialize(NULL));check(espeak_ng_InitializeOutput(ENOUTPUT_MODE_SYNCHRONOUS,0,NULL));check(espeak_ng_SetVoiceByName("en-us"));
    if(!phoneme_tab_list[table].name[0])return 65;
    SelectPhonemeTable((int)table);
    uint32_t count=u32();if(count>16384)return 65;
    printf("{\"table\":%ld,\"constants\":{\"phINVALID\":%u,\"phonSWITCH\":%u,\"defaultVoice\":\"%s\"},\"results\":[",table,phINVALID,phonSWITCH,ESPEAKNG_DEFAULT_VOICE);
    for(uint32_t i=0;i<count;i++){
        uint32_t size=u32(),offset=u32(),report=u32();if(size>8192||offset>size||report>1)return 65;
        char input[8192+8]={0},output[8192+8]={0};if(fread(input,1,size,stdin)!=size)return 65;
        int bad=123456;const char *next=EncodePhonemes(input+offset,output,report?&bad:NULL);
        printf("%s{\"offset\":%zu,\"badPhoneme\":",i?",":"",(size_t)(next-input));if(report)printf("%d",bad);else fputs("null",stdout);
        fputs(",\"phonemesHex\":\"",stdout);for(size_t j=0;output[j];j++)printf("%02x",(unsigned char)output[j]);fputs("\"}",stdout);
    }
    if(fgetc(stdin)!=EOF)return 65;
    puts("]}");check(espeak_ng_Terminate());return fflush(stdout)?74:0;
}
