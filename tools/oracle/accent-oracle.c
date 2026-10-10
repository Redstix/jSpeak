/* Development helper: calls unmodified public LookupAccentedLetter. */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <espeak-ng/espeak_ng.h>
#include <espeak-ng/speak_lib.h>
#include "translate.h"
#include "numbers.h"
static void check(espeak_ng_STATUS status) { if (status != ENS_OK) exit(70); }
static void hex(const char *bytes) { putchar('"'); for (; *bytes; bytes++) printf("%02x", (unsigned char)*bytes); putchar('"'); }
static uint32_t read_u32(void) { unsigned char b[4]; if (fread(b, 1, 4, stdin) != 4) exit(65); return (uint32_t)b[0] | (uint32_t)b[1]<<8 | (uint32_t)b[2]<<16 | (uint32_t)b[3]<<24; }
static void state(void) { printf("{\"repeatCount\":%d,\"repeatHex\":", translator->phonemes_repeat_count); hex(translator->phonemes_repeat); printf(",\"skipWords\":%d}", dictionary_skipwords); }
int main(int argc, char **argv)
{
    if (argc != 3 || (strcmp(argv[1], "profile") && strcmp(argv[1], "lookup"))) return 64;
    espeak_ng_InitializePath(argv[2]); check(espeak_ng_Initialize(NULL));
    check(espeak_ng_InitializeOutput(ENOUTPUT_MODE_SYNCHRONOUS, 0, NULL)); check(espeak_ng_SetVoiceByName("en-us"));
    check(espeak_ng_SetParameter(espeakRATE, 175, 0)); check(espeak_ng_SetParameter(espeakPITCH, 50, 0)); check(espeak_ng_SetParameter(espeakVOLUME, 100, 0));
    InitText(espeakCHARS_UTF8 | espeakPHONEMES | espeakENDPAUSE); espeak_ng_SetRandSeed(1); translator->phonemes_repeat_count = 0;
    if (!strcmp(argv[1], "profile")) printf("{\"voice\":\"en-us\",\"accents\":%d,\"dictCondition\":%u,\"phonemeTable\":%d}\n", translator->langopts.accents, translator->dict_condition, translator->phoneme_tab_ix);
    else {
        uint32_t count = read_u32(); if (count > 16384) return 65;
        translator->dict_condition = read_u32(); uint32_t accents = read_u32(); if (accents > 255) return 65; translator->langopts.accents = accents;
        putchar('[');
        for (uint32_t i = 0; i < count; i++) {
            uint32_t cp = read_u32(), size = read_u32(); if (size > 159) return 65;
            char buffer[N_WORD_PHONEMES] = {0}; if (fread(buffer, 1, size, stdin) != size) return 65;
            printf("%s{\"codepoint\":%u,\"stateBefore\":", i ? "," : "", cp); state();
            LookupAccentedLetter(translator, cp, buffer);
            fputs(",\"phonemesHex\":", stdout); hex(buffer); fputs(",\"stateAfter\":", stdout); state(); putchar('}');
        }
        if (fgetc(stdin) != EOF) return 65;
        puts("]");
    }
    check(espeak_ng_Terminate()); return fflush(stdout) ? 74 : 0;
}
