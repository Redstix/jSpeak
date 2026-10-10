/* Original initialized profile and constants only; no pronunciation answers. */
#include "translate.h"
#include "phoneme.h"
#include <espeak-ng/espeak_ng.h>
#include <stdio.h>
#include <stdlib.h>
static void check(espeak_ng_STATUS s) { if (s != ENS_OK) exit(70); }
int main(int argc,char **argv) {
 if(argc!=2)return 64;
 espeak_ng_InitializePath(argv[1]);check(espeak_ng_Initialize(NULL));
 check(espeak_ng_InitializeOutput(ENOUTPUT_MODE_SYNCHRONOUS,0,NULL));check(espeak_ng_SetVoiceByName("en-us"));
 LANGUAGE_OPTIONS *p=&translator->langopts;
 printf("{\"schemaVersion\":1,\"profile\":{\"voice\":\"en-us\",\"translatorName\":%u,\"dictCondition\":%u,\"phonemeTable\":%d,\"numbers\":%u,\"numbers2\":%u,\"minRoman\":%d,\"maxRoman\":%d,\"thousandsSeparator\":%d,\"decimalSeparator\":%d,\"romanSuffix\":\"%s\",\"ordinalIndicator\":",(unsigned)translator->translator_name,translator->dict_condition,translator->phoneme_tab_ix,p->numbers,p->numbers2,p->min_roman,p->max_roman,p->thousands_sep,p->decimal_sep,p->roman_suffix);
 if(p->ordinal_indicator)printf("\"%s\"",p->ordinal_indicator);else fputs("null",stdout);
 fputs("},\"constants\":{",stdout);
 printf("\"NUM_1900\":%u",(unsigned)NUM_1900);
 printf(",\"NUM_HUNDRED_AND\":%u",(unsigned)NUM_HUNDRED_AND);
 printf(",\"NUM_ROMAN\":%u",(unsigned)NUM_ROMAN);
 printf(",\"NUM_ALLOW_SPACE\":%u",(unsigned)NUM_ALLOW_SPACE);
 printf(",\"NUM_ORDINAL_DOT\":%u",(unsigned)NUM_ORDINAL_DOT);
 printf(",\"NUM_NOPAUSE\":%u",(unsigned)NUM_NOPAUSE);
 printf(",\"NUM_ROMAN_CAPITALS\":%u",(unsigned)NUM_ROMAN_CAPITALS);
 printf(",\"NUM_ROMAN_AFTER\":%u",(unsigned)NUM_ROMAN_AFTER);
 printf(",\"NUM_ROMAN_ORDINAL\":%u",(unsigned)NUM_ROMAN_ORDINAL);
 printf(",\"SAYAS_DIGITS1\":%u",(unsigned)SAYAS_DIGITS1);
 printf(",\"FLAG_INDIVIDUAL_DIGITS\":%u",(unsigned)FLAG_INDIVIDUAL_DIGITS);
 printf(",\"FLAG_ORDINAL\":%u",(unsigned)FLAG_ORDINAL);
 printf(",\"FLAG_MULTIPLE_SPACES\":%u",(unsigned)FLAG_MULTIPLE_SPACES);
 printf(",\"FLAG_NOSPACE\":%u",(unsigned)FLAG_NOSPACE);
 printf(",\"FLAG_HYPHEN_AFTER\":%u",(unsigned)FLAG_HYPHEN_AFTER);
 printf(",\"FLAG_ALL_UPPER\":%u",(unsigned)FLAG_ALL_UPPER);
 printf(",\"FLAG_HAS_DOT\":%u",(unsigned)FLAG_HAS_DOT);
 printf(",\"FLAG_SKIPWORDS\":%u",(unsigned)FLAG_SKIPWORDS);
 printf(",\"FLAG_FOUND\":%u",(unsigned)FLAG_FOUND);
 printf(",\"FLAG_SUFX\":%u",(unsigned)FLAG_SUFX);
 printf(",\"phonEND_WORD\":%u",(unsigned)phonEND_WORD);
 printf(",\"phonPAUSE_SHORT\":%u",(unsigned)phonPAUSE_SHORT);
 printf(",\"phonPAUSE_NOLINK\":%u",(unsigned)phonPAUSE_NOLINK);
 printf(",\"phonSWITCH\":%u",(unsigned)phonSWITCH);
 puts("}}");check(espeak_ng_Terminate());return 0;
}
