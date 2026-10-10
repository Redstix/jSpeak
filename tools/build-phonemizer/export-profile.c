/* Export initialized en-us clause/word2 orchestration options. */
#include "translate.h"
#include <espeak-ng/espeak_ng.h>
#include <espeak-ng/speak_lib.h>
#include <stdio.h>
#include <stdlib.h>
static void check(espeak_ng_STATUS s){if(s!=ENS_OK)exit(70);}
int main(int argc,char **argv){
 if(argc!=2)return 64;
 espeak_ng_InitializePath(argv[1]);check(espeak_ng_Initialize(NULL));check(espeak_ng_InitializeOutput(ENOUTPUT_MODE_SYNCHRONOUS,0,NULL));check(espeak_ng_SetVoiceByName("en-us"));
 check(espeak_ng_SetParameter(espeakRATE,175,0));check(espeak_ng_SetParameter(espeakPITCH,50,0));check(espeak_ng_SetParameter(espeakVOLUME,100,0));
 InitText(espeakCHARS_UTF8|espeakPHONEMES|espeakENDPAUSE);
 printf("{\"schemaVersion\":1,\"profile\":{\"voice\":\"en-us\",\"combineWords\":%d,\"maxDigits\":%d,\"breakNumbers\":%u,\"thousandsSep\":%d,\"decimalSep\":%d,\"optionEndpause\":%d,\"cliOptionEndpause\":%d}}\n",translator->langopts.param[LOPT_COMBINE_WORDS],translator->langopts.max_digits,(unsigned)translator->langopts.break_numbers,translator->langopts.thousands_sep,translator->langopts.decimal_sep,option_endpause,espeakENDPAUSE);
 check(espeak_ng_Terminate());return 0;
}
