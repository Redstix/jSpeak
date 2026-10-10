/* Direct initialized GetVowelStress/SetWordStress oracle, no algorithm copy. */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <espeak-ng/espeak_ng.h>
#include <espeak-ng/speak_lib.h>
#include "dictionary.h"
#include "phoneme.h"
#include "synthdata.h"
#include "translate.h"

static void require_status(espeak_ng_STATUS status)
{
    if (status != ENS_OK) { fprintf(stderr, "Initialization status %d\n", status); exit(70); }
}
static int digit(char c)
{
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    return -1;
}
static void hex(const unsigned char *bytes)
{
    putchar('"');
    while (*bytes) printf("%02x", *bytes++);
    putchar('"');
}
int main(int argc, char **argv)
{
    if (argc != 2) return 64;
    espeak_ng_InitializePath(argv[1]);
    require_status(espeak_ng_Initialize(NULL));
    require_status(espeak_ng_InitializeOutput(ENOUTPUT_MODE_SYNCHRONOUS, 0, NULL));
    require_status(espeak_ng_SetVoiceByName("en-us"));
    SelectPhonemeTable(translator->phoneme_tab_ix);
    printf("{\"profile\":{\"voice\":\"en-us\",\"translatorName\":%u,\"phonemeTable\":%d,\"stressRule\":%d,\"stressFlags\":%u,\"unstressedWord1\":%d,\"unstressedWord2\":%d,\"vowelPause\":%d,\"itLengthen\":%d,\"wordPhonemeCapacity\":%d},\"results\":[",
           (unsigned)translator->translator_name, translator->phoneme_tab_ix, translator->langopts.stress_rule,
           (unsigned)translator->langopts.stress_flags, translator->langopts.unstressed_wd1, translator->langopts.unstressed_wd2,
           translator->langopts.vowel_pause, translator->langopts.param[LOPT_IT_LENGTHEN], N_WORD_PHONEMES);
    char line[1024], encoded[402];
    unsigned row = 0;
    while (fgets(line, sizeof(line), stdin)) {
        unsigned kind, dict_present, dflags, control;
        int tonic, stressed, previous, consumed = 0;
        if (sscanf(line, "%u %u %u %d %u %d %d %401s %n", &kind, &dict_present, &dflags, &tonic, &control, &stressed, &previous, encoded, &consumed) != 8 || line[consumed]) return 65;
        if (kind > 1 || dict_present > 1 || tonic < -1 || tonic > 6 || stressed < 0 || stressed > 99 || ++row > 16384) return 65;
        size_t length = !strcmp(encoded, "-") ? 0 : strlen(encoded);
        if (length % 2 || length > 398) return 65;
        unsigned char phonemes[N_WORD_PHONEMES] = {0};
        for (size_t i = 0; i < length / 2; i++) {
            int a = digit(encoded[i * 2]), b = digit(encoded[i * 2 + 1]);
            if (a < 0 || b < 0) return 65;
            phonemes[i] = (unsigned char)(a * 16 + b);
        }
        translator->prev_last_stress = previous;
        if (row > 1) putchar(',');
        if (kind == 0) {
            signed char stresses[N_WORD_PHONEMES / 2];
            int count;
            int maximum = GetVowelStress(translator, phonemes, stresses, &count, &stressed, (int)control);
            fputs("{\"phonemesHex\":", stdout); hex(phonemes);
            fputs(",\"vowelStress\":[", stdout);
            for (int i = 0; i <= count; i++) printf("%s%d", i ? "," : "", stresses[i]);
            printf("],\"vowelCount\":%d,\"stressedSyllable\":%d,\"maxStress\":%d}", count, stressed, maximum);
        } else {
            unsigned int flags[2] = {dflags, 0};
            SetWordStress(translator, (char *)phonemes, dict_present ? flags : NULL, tonic, (int)control);
            fputs("{\"phonemesHex\":", stdout); hex(phonemes);
            printf(",\"prevLastStress\":%d}", translator->prev_last_stress);
        }
    }
    if (ferror(stdin)) return 74;
    puts("]}");
    espeak_ng_Terminate();
    return 0;
}
