#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <espeak-ng/espeak_ng.h>
#include <espeak-ng/speak_lib.h>
#include "translate.h"
#include "synthesize.h"
#include "voice.h"
#include "wavegen.h"

extern unsigned char *wavefile_data;
extern intptr_t wcmdq[N_WCMDQ][4];
extern int wcmdq_head;
extern int wcmdq_tail;
extern unsigned char *out_ptr;
extern unsigned char *out_end;

static void status(espeak_ng_STATUS value) { if (value != ENS_OK) exit(70); }

int main(int argc, char **argv) {
    if (argc != 2) return 64;
    espeak_ng_InitializePath(argv[1]);
    status(espeak_ng_Initialize(NULL));
    status(espeak_ng_InitializeOutput(ENOUTPUT_MODE_SYNCHRONOUS, 0, NULL));
    status(espeak_ng_SetVoiceByName("en-us"));
    WavegenSetVoice(voice);

    unsigned offset, scale, amplitude;
    int length;
    while (scanf("%u %d %u %u", &offset, &length, &scale, &amplitude) == 4) {
        if (offset > 600104U || length < 0 || length > 1000000 || scale > 255 || amplitude > 0xffffu) return 65;
        short *buffer = calloc((size_t)length, sizeof(short));
        if (!buffer) return 70;
        wcmdq_head = 0;
        wcmdq_tail = 1;
        memset(wcmdq, 0, sizeof(wcmdq));
        wcmdq[0][0] = WCMD_WAVE;
        wcmdq[0][1] = length;
        wcmdq[0][2] = (intptr_t)(wavefile_data + offset);
        wcmdq[0][3] = scale + (amplitude << 8);
        out_ptr = (unsigned char *)buffer;
        out_end = (unsigned char *)(buffer + length);
        WavegenFill();
        printf("{\"samples\":[");
        for (int i = 0; i < length; i++) printf("%s%d", i ? "," : "", buffer[i]);
        fputs("]}\n", stdout);
        free(buffer);
    }
    espeak_ng_Terminate();
    return 0;
}
