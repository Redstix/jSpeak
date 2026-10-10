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
#include "wavegen.h"

extern PHONEME_LIST2 ph_list2[N_PHONEME_LIST];
extern int n_ph_list2;
extern PHONEME_LIST phoneme_list[N_PHONEME_LIST + 1];
extern int n_phoneme_list;
extern unsigned int embedded_list[];

static void status(espeak_ng_STATUS value) { if (value != ENS_OK) exit(70); }

int main(int argc, char **argv) {
    if (argc != 2) return 64;
    espeak_ng_InitializePath(argv[1]);
    status(espeak_ng_Initialize(NULL));
    status(espeak_ng_InitializeOutput(ENOUTPUT_MODE_SYNCHRONOUS, 0, NULL));
    status(espeak_ng_SetVoiceByName("en-us"));

    unsigned count, start_sentence, tone, embedded_count;
    int post_pause, result;
    while ((result = scanf("%u %d %u %u %u", &count, &post_pause, &start_sentence, &tone, &embedded_count)) == 5) {
        if (count < 3 || count > N_PHONEME_LIST || start_sentence > 1 || tone > 15 || embedded_count > 250) return 65;
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
        CalcPitches(translator, (int)tone);
        CalcLengths(translator);
        WcmdqStop();
        Generate(phoneme_list, &n_phoneme_list, 0);
    }
    if (result != EOF || ferror(stdin)) return 65;
    espeak_ng_Terminate();
    return 0;
}
