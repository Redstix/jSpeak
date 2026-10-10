#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <espeak-ng/espeak_ng.h>
#include <espeak-ng/speak_lib.h>
#include "translate.h"
#include "synthesize.h"
#include "phonemelist.h"
#include "intonation.h"
#include "setlengths.h"
#include "synthdata.h"
#include "voice.h"
#include "wavegen.h"

extern PHONEME_LIST2 ph_list2[N_PHONEME_LIST];
extern int n_ph_list2;
extern PHONEME_LIST phoneme_list[N_PHONEME_LIST + 1];
extern int n_phoneme_list;
extern unsigned int embedded_list[];
extern intptr_t wcmdq[N_WCMDQ][4];
extern int wcmdq_head;
extern int wcmdq_tail;

static void status(espeak_ng_STATUS value) { if (value != ENS_OK) exit(70); }

static void emit_profile(void) {
    printf("{\"voice\":\"en-us\",\"translatorName\":%u,\"phonemeTable\":%d,\"sampleRate\":%d,"
           "\"capacity\":%d,\"commandCapacity\":%d}",
           (unsigned)translator->translator_name, translator->phoneme_tab_ix, samplerate,
           N_PHONEME_LIST, N_WCMDQ);
}

static void emit_integer(intptr_t value) {
    printf("%lld", (long long)value);
}

static void emit_frame(intptr_t value) {
    if (value == 0) { fputs("null", stdout); return; }
    if (wavefile_data != NULL && value >= (intptr_t)wavefile_data &&
        value < (intptr_t)(wavefile_data + 600104)) {
        printf("{\"phondataOffset\":%lld}", (long long)(value - (intptr_t)wavefile_data));
        return;
    }
    unsigned long long hash = 1469598103934665603ULL;
    const unsigned char *bytes = (const unsigned char *)(uintptr_t)value;
    for (size_t i = 0; i < sizeof(frame_t); i++) {
        hash ^= bytes[i];
        hash *= 1099511628211ULL;
    }
    printf("{\"frameHash\":\"%016llx\"}", hash);
}

static void emit_envelope(intptr_t value) {
    if (value == 0) { fputs("null", stdout); return; }
    for (int i = 0; i < N_ENVELOPE_DATA; i++) {
        if (value == (intptr_t)envelope_data[i]) {
            printf("{\"envelope\":%d}", i);
            return;
        }
    }
    printf("{\"pointer\":%lld}", (long long)value);
}

static void emit_wave(intptr_t value) {
    if (value == 0) { fputs("null", stdout); return; }
    if (wavefile_data != NULL && value >= (intptr_t)wavefile_data &&
        value < (intptr_t)(wavefile_data + 600104)) {
        printf("{\"phondataOffset\":%lld}", (long long)(value - (intptr_t)wavefile_data));
        return;
    }
    printf("{\"pointer\":%lld}", (long long)value);
}

static void emit_command(int index) {
    intptr_t *q = wcmdq[index];
    int type = q[0] & 0xff;
    printf("{\"index\":%d,\"type\":%lld,\"a\":%lld", index, (long long)q[0], (long long)q[1]);
    if (type == WCMD_AMPLITUDE || type == WCMD_PITCH) {
        fputs(",\"b\":", stdout); emit_envelope(q[2]);
        fputs(",\"c\":", stdout); emit_integer(q[3]);
    } else if (type == WCMD_KLATT || type == WCMD_KLATT2 || type == WCMD_SPECT || type == WCMD_SPECT2) {
        fputs(",\"b\":", stdout); emit_frame(q[2]);
        fputs(",\"c\":", stdout); emit_frame(q[3]);
    } else if (type == WCMD_WAVE || type == WCMD_WAVE2) {
        fputs(",\"b\":", stdout); emit_wave(q[2]);
        fputs(",\"c\":", stdout); emit_integer(q[3]);
    } else if (type == WCMD_VOICE) {
        fputs(",\"b\":{\"voice\":1}", stdout);
    } else if (type == WCMD_EMBEDDED || type == WCMD_MARKER || type == WCMD_PHONEME_ALIGNMENT || type == WCMD_SONIC_SPEED) {
        fputs(",\"b\":", stdout); emit_integer(q[2]);
        if (type == WCMD_PHONEME_ALIGNMENT) {
            fputs(",\"c\":", stdout); emit_integer(q[3]);
        }
    }
    putchar('}');
}

static void emit_commands(void) {
    printf("{\"count\":%d,\"items\":[", wcmdq_tail);
    for (int i = 0; i < wcmdq_tail; i++) {
        if (i) putchar(',');
        emit_command(i);
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

    unsigned count, start_sentence, tone, embedded_count, row = 0;
    int post_pause, result;
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
        CalcPitches(translator, (int)tone);
        CalcLengths(translator);
        WcmdqStop();
        Generate(phoneme_list, &n_phoneme_list, 0);
        if (row > 1) putchar(',');
        emit_commands();
    }
    if (result != EOF || ferror(stdin)) return 65;
    puts("]}");
    espeak_ng_Terminate();
    return 0;
}
