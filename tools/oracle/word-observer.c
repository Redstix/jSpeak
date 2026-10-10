/* GNU ld --wrap changes call routing only; the original library owns behavior. */
#include "word-shared.h"
int __real_TranslateWord3(Translator *, char *, WORD_TAB *, int, char *, bool *, ALPHABET *, char [], size_t);
static unsigned long next_id;
static unsigned depth;
static FILE *trace_file;
static int trace_checked;
static FILE *trace(void) {
    if (!trace_checked) {
        const char *name = getenv("JSPEAK_WORD_TRACE_FILE"); trace_checked = 1;
        if (name && name[0]) { trace_file = fopen(name, "w"); if (!trace_file) { perror("word trace"); exit(73); } }
    }
    return trace_file;
}
static void header(FILE *out, const char *phase, unsigned long id, unsigned nesting, Translator *tr, char *word, WORD_TAB *words, int remaining, char *word_out, bool *any, ALPHABET *alphabet, char *phonemes, size_t capacity, char *full_buffer, size_t full_size, size_t offset) {
    fprintf(out, "{\"schemaVersion\":1,\"phase\":\"%s\",\"id\":%lu,\"depth\":%u,\"translatorName\":%u,\"remaining\":%d,\"wordOut\":%s,\"capacity\":%zu,\"prefixHex\":",
        phase, id, nesting, (unsigned)tr->translator_name, remaining, word_out ? "true" : "false", capacity);
    word_hex_bytes(out, word - 2, 2); fputs(",\"utf8Hex\":", out); word_hex(out, word);
    fputs(",\"words\":", out); word_wtab(out, words, words ? remaining > 0 ? remaining : 1 : 0);
    fputs(",\"state\":", out); word_state(out, tr, word);
    fputs(",\"anyStressedWords\":", out); fputs(any ? *any ? "true" : "false" : "null", out);
    fputs(",\"alphabetCodepoint\":", out); if (alphabet) fprintf(out, "%u", alphabet->range_min); else fputs("null", out);
    fputs(",\"phonemesHex\":", out); word_hex(out, phonemes);
    fputs(",\"bufferHex\":", out); if (full_buffer) word_hex_bytes(out, full_buffer, full_size); else fputs("null", out);
    fputs(",\"offset\":", out); if (full_buffer) fprintf(out, "%zu", offset); else fputs("null", out);
}
int __wrap_TranslateWord3(Translator *tr, char *word, WORD_TAB *words, int remaining, char *word_out, bool *any, ALPHABET *alphabet, char phonemes[], size_t capacity) {
    FILE *out = trace();
    if (!out) return __real_TranslateWord3(tr, word, words, remaining, word_out, any, alphabet, phonemes, capacity);
    unsigned long id = next_id++; unsigned nesting = depth++;
    // Native in-clause calls obey TranslateClause's WORD_TAB.start contract:
    // word == sbuf + start. Replacement buffers have an external clause_end
    // and are never reconstructed from the inherited WORD_TAB.
    char *full_buffer = NULL; size_t full_size = 0, offset = 0;
    uintptr_t at = (uintptr_t)word, clause_end = (uintptr_t)translator->clause_end;
    size_t source_size = strlen(word);
    if (tr == translator && words && words[0].start >= 3 && words[0].start + source_size < 800 && clause_end >= at && clause_end <= at + source_size) {
        offset = words[0].start; full_buffer = word - offset; full_size = offset + source_size + 1;
        if (full_buffer[0] != 0 || full_buffer[1] != ' ' || full_buffer[2] != ' ') { full_buffer = NULL; full_size = offset = 0; }
    }
    header(out, "enter", id, nesting, tr, word, words, remaining, word_out, any, alphabet, phonemes, capacity, full_buffer, full_size, offset); fputs("}\n", out); fflush(out);
    int flags = __real_TranslateWord3(tr, word, words, remaining, word_out, any, alphabet, phonemes, capacity);
    depth--;
    header(out, "exit", id, nesting, tr, word, words, remaining, word_out, any, alphabet, phonemes, capacity, full_buffer, full_size, offset);
    fprintf(out, ",\"flags\":%u,\"wordOutHex\":", (unsigned)flags); if (word_out) word_hex(out, word_out); else fputs("null", out); fputs("}\n", out);
    if (fflush(out) || ferror(out)) exit(74);
    return flags;
}
