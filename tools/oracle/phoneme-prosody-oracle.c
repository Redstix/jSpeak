#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <espeak-ng/espeak_ng.h>
#include <espeak-ng/speak_lib.h>
#include "translate.h"
#include "synthesize.h"
#include "phonemelist.h"
#include "intonation.h"
#include "setlengths.h"
#include "synthdata.h"
#include "voice.h"

extern PHONEME_LIST2 ph_list2[N_PHONEME_LIST];
extern int n_ph_list2;
extern PHONEME_LIST phoneme_list[N_PHONEME_LIST + 1];
extern int n_phoneme_list;
extern unsigned int embedded_list[];

static void status(espeak_ng_STATUS value) { if (value != ENS_OK) exit(70); }

static void emit_profile(void) {
    printf("{\"voice\":\"en-us\",\"translatorName\":%u,\"phonemeTable\":%d,\"capacity\":%d,"
           "\"stressFlags\":%u,\"intonationGroup\":%d,\"toneLanguage\":%d,\"optionWordgap\":%d,\"reduce\":%d,"
           "\"pauseLengthMod\":%d,\"vowelLengthMod\":%d,\"speedf1\":%d,\"speedf2\":%d,\"speedf3\":%d,\"stressLengths\":[",
           (unsigned)translator->translator_name, translator->phoneme_tab_ix, N_PHONEME_LIST,
           translator->langopts.stress_flags, translator->langopts.intonation_group,
           translator->langopts.tone_language, option_wordgap, translator->langopts.param[LOPT_REDUCE],
           phoneme_tab[phonPAUSE]->length_mod, phoneme_tab[147]->length_mod,
           voice->speedf1, voice->speedf2, voice->speedf3);
    for (int i = 0; i < 8; i++) printf("%s%d", i ? "," : "", translator->stress_lengths[i]);
    fputs("]}", stdout);
}

static void emit_list(const char *stage) {
    printf("{\"stage\":\"%s\",\"count\":%d", stage, n_phoneme_list);
#define COLUMN(name, field, format) do { fputs(",\"" name "\":[", stdout); for (int i = 0; i < n_phoneme_list; i++) printf("%s" format, i ? "," : "", phoneme_list[i].field); putchar(']'); } while (0)
    COLUMN("phcode", phcode, "%u");
    COLUMN("stresslevel", stresslevel, "%u");
    COLUMN("wordstress", wordstress, "%u");
    COLUMN("tonePh", tone_ph, "%u");
    COLUMN("sourceix", sourceix, "%u");
    COLUMN("synthflags", synthflags, "%u");
    COLUMN("length", length, "%u");
    COLUMN("env", env, "%u");
    COLUMN("type", type, "%u");
    COLUMN("prepause", prepause, "%u");
    COLUMN("amp", amp, "%u");
    COLUMN("newword", newword, "%u");
    COLUMN("pitch1", pitch1, "%u");
    COLUMN("pitch2", pitch2, "%u");
    COLUMN("stdLength", std_length, "%u");
    COLUMN("phontabAddr", phontab_addr, "%u");
    COLUMN("soundParam", sound_param, "%d");
#undef COLUMN
    fputs(",\"tonePhData\":[", stdout);
    for (int i = 0; i < n_phoneme_list; i++) {
        unsigned value = phoneme_list[i].tone_ph_data ? (unsigned)phoneme_list[i].tone_ph_data->code + 1 : 0;
        printf("%s%u", i ? "," : "", value);
    }
    fputs("]}", stdout);
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

    unsigned count, start_sentence, tone, row = 0;
    int post_pause, result;
    unsigned embedded_count;
    while ((result = scanf("%u %d %u %u %u", &count, &post_pause, &start_sentence, &tone, &embedded_count)) == 5) {
        if (count < 3 || count > N_PHONEME_LIST || start_sentence > 1 || tone > 15 ||
            embedded_count > 250 || ++row > 16384) return 65;
        memset(embedded_list, 0, 250 * sizeof(embedded_list[0]));
        for (unsigned i = 0; i < embedded_count; i++) {
            unsigned value;
            if (scanf("%u", &value) != 1 || value > 0xffffffffu) return 65;
            embedded_list[i] = value;
        }
        memset(ph_list2, 0, sizeof(ph_list2));
        for (unsigned i = 0; i < count; i++) {
            unsigned code, stress, wordstress, tone_ph, source, flags;
            if (scanf("%u %u %u %u %u %u", &code, &stress, &wordstress, &tone_ph, &source, &flags) != 6 ||
                code > 255 || stress > 255 || wordstress > 255 || tone_ph > 255 ||
                source > 65535 || flags > 65535) return 65;
            ph_list2[i].phcode = (unsigned char)code;
            ph_list2[i].stresslevel = (unsigned char)stress;
            ph_list2[i].wordstress = (unsigned char)wordstress;
            ph_list2[i].tone_ph = (unsigned char)tone_ph;
            ph_list2[i].sourceix = (unsigned short)source;
            ph_list2[i].synthflags = (unsigned short)flags;
        }
        if (ph_list2[count - 1].phcode != phonPAUSE || ph_list2[count - 2].phcode != phonPAUSE) return 65;
        n_ph_list2 = (int)count;
        SelectPhonemeTable(translator->phoneme_tab_ix);
        MakePhonemeList(translator, post_pause, start_sentence != 0);
        if (n_phoneme_list < 2 || n_phoneme_list > N_PHONEME_LIST) return 70;
        if (row > 1) putchar(',');
        fputs("{\"pitches\":", stdout);
        CalcPitches(translator, (int)tone);
        emit_list("pitches");
        fputs(",\"lengths\":", stdout);
        CalcLengths(translator);
        emit_list("lengths");
        putchar('}');
    }
    if (result != EOF || ferror(stdin)) return 65;
    puts("]}");
    espeak_ng_Terminate();
    return 0;
}
