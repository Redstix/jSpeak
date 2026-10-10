/* Read original static data in its original translation unit. No answers cached. */
#include "numbers.c"
static void check_export(espeak_ng_STATUS status) { if (status != ENS_OK) exit(70); }
int main(int argc, char **argv)
{
    if (argc != 2) return 64;
    espeak_ng_InitializePath(argv[1]); check_export(espeak_ng_Initialize(NULL));
    check_export(espeak_ng_InitializeOutput(ENOUTPUT_MODE_SYNCHRONOUS, 0, NULL));
    check_export(espeak_ng_SetVoiceByName("en-us"));
    printf("{\"schemaVersion\":1,\"profile\":{\"voice\":\"en-us\",\"accents\":%d,\"dictCondition\":%u,\"phonemeTable\":%d},", translator->langopts.accents, translator->dict_condition, translator->phoneme_tab_ix);
    printf("\"constants\":{\"M_LIGATURE\":%u,\"phonPAUSE_VSHORT\":%u,\"phonSTRESS_P\":%u,\"phonSTRESS_2\":%u},\"accents\":[", M_LIGATURE, phonPAUSE_VSHORT, phonSTRESS_P, phonSTRESS_2);
    for (size_t i = 0; i < sizeof(accents_tab) / sizeof(accents_tab[0]); i++) printf("%s{\"name\":\"%s\",\"flags\":%d}", i ? "," : "", accents_tab[i].name, accents_tab[i].accent_flags);
    fputs("],\"nonAscii\":[", stdout);
    for (size_t i = 0; i < sizeof(non_ascii_tab) / sizeof(non_ascii_tab[0]); i++) printf("%s%u", i ? "," : "", (unsigned)non_ascii_tab[i]);
    fputs("],\"latin\":[", stdout);
    for (size_t i = 0; i < sizeof(letter_accents_0e0) / sizeof(letter_accents_0e0[0]); i++) printf("%s%u", i ? "," : "", letter_accents_0e0[i]);
    fputs("],\"ipa\":[", stdout);
    for (size_t i = 0; i < sizeof(letter_accents_250) / sizeof(letter_accents_250[0]); i++) printf("%s%u", i ? "," : "", letter_accents_250[i]);
    puts("]}");
    check_export(espeak_ng_Terminate()); return fflush(stdout) ? 74 : 0;
}
