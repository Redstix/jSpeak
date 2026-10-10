#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <espeak-ng/espeak_ng.h>
#include <espeak-ng/speak_lib.h>
#include "translate.h"
#include "synthesize.h"
#include "phonemelist.h"
#include "synthdata.h"

extern PHONEME_LIST2 ph_list2[N_PHONEME_LIST];
extern int n_ph_list2;
extern PHONEME_LIST phoneme_list[N_PHONEME_LIST + 1];
extern int n_phoneme_list;

static void status(espeak_ng_STATUS value) { if (value != ENS_OK) exit(70); }

static void emit_profile(void) {
    printf("{\"voice\":\"en-us\",\"translatorName\":%u,\"phonemeTable\":%d,\"capacity\":%d,"
           "\"stressFlags\":%u,\"vowelPause\":%d,\"wordGap\":%d,\"optionWordgap\":%d,\"reduce\":%d}",
           (unsigned)translator->translator_name, translator->phoneme_tab_ix, N_PHONEME_LIST,
           translator->langopts.stress_flags, translator->langopts.vowel_pause,
           translator->langopts.word_gap, option_wordgap, translator->langopts.param[LOPT_REDUCE]);
}

static void emit_result(void) {
    printf("{\"count\":%d,\"phcode\":[", n_phoneme_list);
    for (int i = 0; i < n_phoneme_list; i++) printf("%s%u", i ? "," : "", (unsigned)phoneme_list[i].phcode);
    fputs("],\"stresslevel\":[", stdout);
    for (int i = 0; i < n_phoneme_list; i++) printf("%s%u", i ? "," : "", (unsigned)phoneme_list[i].stresslevel);
    fputs("],\"wordstress\":[", stdout);
    for (int i = 0; i < n_phoneme_list; i++) printf("%s%u", i ? "," : "", (unsigned)phoneme_list[i].wordstress);
    fputs("],\"tonePh\":[", stdout);
    for (int i = 0; i < n_phoneme_list; i++) printf("%s%u", i ? "," : "", (unsigned)phoneme_list[i].tone_ph);
    fputs("],\"sourceix\":[", stdout);
    for (int i = 0; i < n_phoneme_list; i++) printf("%s%u", i ? "," : "", (unsigned)phoneme_list[i].sourceix);
    fputs("],\"synthflags\":[", stdout);
    for (int i = 0; i < n_phoneme_list; i++) printf("%s%u", i ? "," : "", (unsigned)phoneme_list[i].synthflags);
    fputs("],\"length\":[", stdout);
    for (int i = 0; i < n_phoneme_list; i++) printf("%s%u", i ? "," : "", (unsigned)phoneme_list[i].length);
    fputs("],\"env\":[", stdout);
    for (int i = 0; i < n_phoneme_list; i++) printf("%s%u", i ? "," : "", (unsigned)phoneme_list[i].env);
    fputs("],\"type\":[", stdout);
    for (int i = 0; i < n_phoneme_list; i++) printf("%s%u", i ? "," : "", (unsigned)phoneme_list[i].type);
    fputs("],\"prepause\":[", stdout);
    for (int i = 0; i < n_phoneme_list; i++) printf("%s%u", i ? "," : "", (unsigned)phoneme_list[i].prepause);
    fputs("],\"amp\":[", stdout);
    for (int i = 0; i < n_phoneme_list; i++) printf("%s%u", i ? "," : "", (unsigned)phoneme_list[i].amp);
    fputs("],\"newword\":[", stdout);
    for (int i = 0; i < n_phoneme_list; i++) printf("%s%u", i ? "," : "", (unsigned)phoneme_list[i].newword);
    fputs("],\"pitch1\":[", stdout);
    for (int i = 0; i < n_phoneme_list; i++) printf("%s%u", i ? "," : "", (unsigned)phoneme_list[i].pitch1);
    fputs("],\"pitch2\":[", stdout);
    for (int i = 0; i < n_phoneme_list; i++) printf("%s%u", i ? "," : "", (unsigned)phoneme_list[i].pitch2);
    fputs("],\"stdLength\":[", stdout);
    for (int i = 0; i < n_phoneme_list; i++) printf("%s%u", i ? "," : "", (unsigned)phoneme_list[i].std_length);
    fputs("],\"phontabAddr\":[", stdout);
    for (int i = 0; i < n_phoneme_list; i++) printf("%s%u", i ? "," : "", (unsigned)phoneme_list[i].phontab_addr);
    fputs("],\"soundParam\":[", stdout);
    for (int i = 0; i < n_phoneme_list; i++) printf("%s%d", i ? "," : "", phoneme_list[i].sound_param);
    fputs("],\"tonePhData\":[", stdout);
    for (int i = 0; i < n_phoneme_list; i++) {
        unsigned value = phoneme_list[i].tone_ph_data ? (unsigned)phoneme_list[i].tone_ph_data->code + 1 : 0;
        printf("%s%u", i ? "," : "", value);
    }
    putchar(']');
    putchar('}');
}

int main(int argc, char **argv) {
    if (argc != 2) return 64;
    espeak_ng_InitializePath(argv[1]);
    status(espeak_ng_Initialize(NULL));
    status(espeak_ng_InitializeOutput(ENOUTPUT_MODE_SYNCHRONOUS, 0, NULL));
    status(espeak_ng_SetVoiceByName("en-us"));

    fputs("{\"profile\":", stdout);
    emit_profile();
    fputs(",\"results\":[", stdout);

    unsigned count, start_sentence, row = 0;
    int post_pause, result;
    while ((result = scanf("%u %d %u", &count, &post_pause, &start_sentence)) == 3) {
        if (count < 3 || count > N_PHONEME_LIST || start_sentence > 1 || ++row > 16384) return 65;
        memset(ph_list2, 0, sizeof(ph_list2));
        for (unsigned i = 0; i < count; i++) {
            unsigned code, stress, wordstress, tone, source, flags;
            if (scanf("%u %u %u %u %u %u", &code, &stress, &wordstress, &tone, &source, &flags) != 6 ||
                code > 255 || stress > 255 || wordstress > 255 || tone > 255 ||
                source > 65535 || flags > 65535) return 65;
            ph_list2[i].phcode = (unsigned char)code;
            ph_list2[i].stresslevel = (unsigned char)stress;
            ph_list2[i].wordstress = (unsigned char)wordstress;
            ph_list2[i].tone_ph = (unsigned char)tone;
            ph_list2[i].sourceix = (unsigned short)source;
            ph_list2[i].synthflags = (unsigned short)flags;
        }
        if (ph_list2[count - 1].phcode != phonPAUSE || ph_list2[count - 2].phcode != phonPAUSE) return 65;
        n_ph_list2 = (int)count;
        SelectPhonemeTable(translator->phoneme_tab_ix);
        MakePhonemeList(translator, post_pause, start_sentence != 0);
        if (n_phoneme_list < 2 || n_phoneme_list > N_PHONEME_LIST) return 70;
        if (row > 1) putchar(',');
        emit_result();
    }
    if (result != EOF || ferror(stdin)) return 65;
    puts("]}");
    espeak_ng_Terminate();
    return 0;
}
