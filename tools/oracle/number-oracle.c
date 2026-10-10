#ifdef JSPEAK_NUMBER_CLEAN
#include "numbers.h"
#else
#include "numbers.c"
#endif
#include "word-shared.h"
static void numeric_state(FILE *out) {
#ifdef JSPEAK_NUMBER_CLEAN
 fputs("null",out);
#else
 fprintf(out,"{\"speakMissingThousands\":%d,\"numberControl\":%d,\"nDigitLookup\":%d,\"ordinal2Hex\":",speak_missing_thousands,number_control,n_digit_lookup);
 word_hex(out,ph_ordinal2);fputs(",\"ordinal2xHex\":",out);word_hex(out,ph_ordinal2x);fputc('}',out);
#endif
}
static void check(espeak_ng_STATUS s) { if (s != ENS_OK) { fprintf(stderr, "Initialization status %d\n", s); exit(70); } }
static uint32_t u32(void) { unsigned char b[4]; if (fread(b, 1, 4, stdin) != 4) exit(65); return (uint32_t)b[0] | (uint32_t)b[1]<<8 | (uint32_t)b[2]<<16 | (uint32_t)b[3]<<24; }
static void read_exact(void *p, size_t n) { if (fread(p, 1, n, stdin) != n) exit(65); }
int main(int argc, char **argv) {
    if (argc != 3 || (strcmp(argv[1], "profile") && strcmp(argv[1], "number") && strcmp(argv[1], "roman"))) return 64;
    espeak_ng_InitializePath(argv[2]); check(espeak_ng_Initialize(NULL)); check(espeak_ng_InitializeOutput(ENOUTPUT_MODE_SYNCHRONOUS, 0, NULL)); check(espeak_ng_SetVoiceByName("en-us"));
    check(espeak_ng_SetParameter(espeakRATE, 175, 0)); check(espeak_ng_SetParameter(espeakPITCH, 50, 0)); check(espeak_ng_SetParameter(espeakVOLUME, 100, 0));
    InitText(espeakCHARS_UTF8 | espeakPHONEMES | espeakENDPAUSE); espeak_ng_SetRandSeed(1); SelectPhonemeTable(translator->phoneme_tab_ix);
    if (!strcmp(argv[1], "profile")) { word_profile(stdout); putchar('\n'); check(espeak_ng_Terminate()); return 0; }
    uint32_t size=u32(),count=u32(),remaining=u32(),capacity=u32(),control=u32(),flags0=u32(),flags1=u32(),initial_size=u32(),repeat_size=u32(),ordinal_size=u32(),ordinalx_size=u32();
    int initial_missing=(int)u32(), initial_control=(int)u32(), initial_lookup=(int)u32();
#ifdef JSPEAK_NUMBER_CLEAN
    if(initial_missing||initial_control||initial_lookup||ordinal_size||ordinalx_size)return 65;
#else
    speak_missing_thousands=initial_missing;number_control=initial_control;n_digit_lookup=initial_lookup;
#endif
    if(size<1||size>4096||count<1||count>300||remaining>count||capacity<200||capacity>1024||initial_size>=capacity||repeat_size>19||ordinal_size>11||ordinalx_size>11)return 65;
    // Explicit caller state, in the same order as word.mjs:wordStateFields.
    translator->dict_condition = u32(); translator->expect_verb = (int)u32(); translator->expect_verb_s = (int)u32(); translator->expect_noun = (int)u32(); translator->expect_past = (int)u32();
    translator->prev_dict_flags[0] = (int)u32(); translator->prev_dict_flags[1] = (int)u32(); translator->clause_terminator = u32(); uint32_t clause_end = u32();
    translator->clause_lower_count = (int)u32(); translator->clause_upper_count = (int)u32(); pre_pause = (int)u32(); translator->prev_last_stress = (int)u32(); translator->prepause_timeout = (int)u32();
    translator->end_stressed_vowel = (int)u32(); translator->word_vowel_count = (int)u32(); translator->word_stressed_count = (int)u32(); translator->phonemes_repeat_count = (int)u32();
    dictionary_skipwords = (int)u32(); option_sayas = (int)u32(); option_capitals = (int)u32(); option_tone_flags = (int)u32();
    if (clause_end > size) return 65;
    char text[4096 + 512] = {0}; read_exact(text, 3); read_exact(text + 3, size);
    if (memchr(text + 3, 0, size) || text[size + 2] != ' ') return 65;
    translator->clause_end = text + 3 + clause_end;
    char phonemes[1024] = {0}; read_exact(phonemes, initial_size);
    memset(translator->phonemes_repeat, 0, sizeof(translator->phonemes_repeat)); read_exact(translator->phonemes_repeat, repeat_size);
#ifndef JSPEAK_NUMBER_CLEAN
    read_exact(ph_ordinal2,ordinal_size);read_exact(ph_ordinal2x,ordinalx_size);
#endif
    WORD_TAB words[300] = {{0}};
    for (uint32_t i = 0; i < count; i++) {
        uint32_t flags = u32(), start = u32(), pause = u32(), source = u32(), length = u32();
        if (start > 65535 || pause > 255 || source > 65535 || length > 255) return 65;
        words[i].flags = flags; words[i].start = start; words[i].pre_pause = pause; words[i].sourceix = source; words[i].length = length;
    }
    if (fgetc(stdin) != EOF) return 65;
    fputs("{\"stateBefore\":",stdout);word_state(stdout,translator,text+3);fputs(",\"numberStateBefore\":",stdout);numeric_state(stdout);
    unsigned int flags[2]={flags0,flags1};
    int found=!strcmp(argv[1],"number")?TranslateNumber(translator,text+3,phonemes,phonemes+capacity,flags,words,remaining,(int)control):TranslateRoman(translator,text+3,phonemes,phonemes+capacity,words,remaining);
    printf(",\"found\":%d,\"flags\":[%u,%u],\"phonemesHex\":",found,flags[0],flags[1]);word_hex(stdout,phonemes);
    fputs(",\"bufferAfterHex\":",stdout);word_hex_bytes(stdout,text,size+3);
    fputs(",\"wordsAfter\":",stdout);word_wtab(stdout,words,count);fputs(",\"stateAfter\":",stdout);word_state(stdout,translator,text+3);
    fputs(",\"numberStateAfter\":",stdout);numeric_state(stdout);puts("}");
    check(espeak_ng_Terminate());return fflush(stdout)?74:0;
}
