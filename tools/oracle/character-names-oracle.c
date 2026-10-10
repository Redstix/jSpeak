/* Included after an unchanged original readclause.c translation unit by build tool.
 * Calls its real static functions; adds observation only. */
#include <stdint.h>
#include "numbers.h"
static void jcn_check(espeak_ng_STATUS status) { if(status!=ENS_OK) exit(70); }
static uint32_t jcn_u32(const unsigned char *p) { return (uint32_t)p[0]|(uint32_t)p[1]<<8|(uint32_t)p[2]<<16|(uint32_t)p[3]<<24; }
static void jcn_hex(const char *s) { putchar('"'); while(*s) printf("%02x",(unsigned char)*s++); putchar('"'); }
static void jcn_state(void) {
    printf("{\"repeatCount\":%d,\"repeatHex\":",translator->phonemes_repeat_count);jcn_hex(translator->phonemes_repeat);
    printf(",\"skipWords\":%d,\"prevLastStress\":%d}",dictionary_skipwords,translator->prev_last_stress);
}
int main(int argc,char **argv) {
    if(argc!=2) return 64;
    espeak_ng_InitializePath(argv[1]);jcn_check(espeak_ng_Initialize(NULL));
    jcn_check(espeak_ng_InitializeOutput(ENOUTPUT_MODE_SYNCHRONOUS,0,NULL));jcn_check(espeak_ng_SetVoiceByName("en-us"));
    jcn_check(espeak_ng_SetParameter(espeakRATE,175,0));jcn_check(espeak_ng_SetParameter(espeakPITCH,50,0));jcn_check(espeak_ng_SetParameter(espeakVOLUME,100,0));
    InitText(espeakCHARS_UTF8|espeakPHONEMES|espeakENDPAUSE);espeak_ng_SetRandSeed(1);
    translator->phonemes_repeat_count=0;
    unsigned char input[65536];size_t size=fread(input,1,sizeof(input),stdin);
    if(ferror(stdin)||size<8||size==sizeof(input)) return 65;
    uint32_t mode=jcn_u32(input);if(mode!=0x314e434a && mode!=0x314c434a) return 65;
    uint32_t width=mode==0x314c434a?16:12;
    uint32_t count=jcn_u32(input+4);if(count>4095||size!=8+count*width) return 65;
    putchar('[');
    for(uint32_t i=0;i<count;i++) {
        const unsigned char *entry=input+8+i*width;uint32_t cp=jcn_u32(entry),only=jcn_u32(entry+4),reset=jcn_u32(entry+width-4);
        if((mode==0x314e434a && only>1)||reset>1) return 65;
        if(reset) translator->phonemes_repeat_count=0;
        char output[200]={0};printf("%s{\"stateBefore\":",i?",":"");jcn_state();
        if(mode==0x314e434a) LookupCharName(output,translator,(int)cp,only!=0);
        else {
            int next=(int32_t)only;uint32_t control=jcn_u32(entry+8);
            if(next < -1 || next>255 || control>0x7fffffff) return 65;
            LookupLetter(translator,cp,next,output,control);
        }
        fputs(",\"outputHex\":",stdout);jcn_hex(output);fputs(",\"stateAfter\":",stdout);jcn_state();putchar('}');
    }
    puts("]");jcn_check(espeak_ng_Terminate());return fflush(stdout)==0?0:74;
}
