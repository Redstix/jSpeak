/* Read-only boundary observations, included in an isolated original translate.c. */
#include "word-shared.h"
extern int jspeak_observed_phoneme_table(void);
static int js_original_TranslateWord2(Translator *, char *, WORD_TAB *, int, int);
static FILE *js_cw2_file;
static int js_cw2_checked;
static unsigned long js_cw2_next_call, js_cw2_clause;
static char *js_cw2_clause_buffer, *js_cw2_buffer;
static size_t js_cw2_clause_size, js_cw2_size;
static const char *js_cw2_origin;
static int js_cw2_word_index, js_cw2_sub_index;
static FILE *js_cw2_trace(void) {
    if (!js_cw2_checked) {
        const char *name=getenv("JSPEAK_CLAUSE_WORD2_TRACE_FILE"); js_cw2_checked=1;
        if (name && *name) { js_cw2_file=fopen(name,"w"); if (!js_cw2_file) { perror("clause word2 trace"); exit(73); } }
    }
    return js_cw2_file;
}
static void js_cw2_flush(FILE *out) { fputs("}\n",out); if (fflush(out) || ferror(out)) exit(74); }
static void js_cw2_list(FILE *out) {
    fprintf(out,"{\"count\":%d,\"capacity\":%d,\"items\":[",n_ph_list2,N_PHONEME_LIST);
    for (int i=0;i<n_ph_list2;i++) {
        PHONEME_LIST2 *p=&ph_list2[i];
        fprintf(out,"%s{\"synthflags\":%u,\"phcode\":%u,\"stresslevel\":%u,\"sourceix\":%u,\"wordstress\":%u,\"tonePh\":%u}",i?",":"",p->synthflags,p->phcode,p->stresslevel,p->sourceix,p->wordstress,p->tone_ph);
    }
    fputs("]}",out);
}
static void js_cw2_state(FILE *out, Translator *tr, char *word) {
    fputs("\"wordState\":",out);word_state(out,tr,word);
    fprintf(out,",\"clauseState\":{\"clauseEndOffset\":%zu,\"prePause\":%d,\"optionEmphasis\":%d,\"optionSayas2\":%d,\"countSayasDigits\":%d,\"wordEmphasis\":%d,\"embeddedFlag\":%d,\"anyStressedWords\":%s,\"newSentence\":%s,\"maxClausePause\":%d,\"countWords\":%d,\"countSentences\":%d,\"clauseStartChar\":%d,\"clauseStartWord\":%d,\"skipWords\":%d,\"skipSentences\":%d,\"skippingText\":%s,\"optionEndpause\":%d,\"optionWordgap\":%d,\"selectedTable\":%d,\"voiceTable\":%d,\"currentAlphabet\":",
        (size_t)(tr->clause_end-js_cw2_clause_buffer),pre_pause,option_emphasis,option_sayas2,count_sayas_digits,word_emphasis,embedded_flag,
        any_stressed_words?"true":"false",new_sentence?"true":"false",max_clause_pause,count_words,count_sentences,clause_start_char,clause_start_word,
        skip_words,skip_sentences,skipping_text?"true":"false",option_endpause,option_wordgap,jspeak_observed_phoneme_table(),voice->phoneme_tab_ix);
    if (current_alphabet) fprintf(out,"%u",current_alphabet->range_min); else fputs("null",out);
    fputs("},\"embedded\":{\"capacity\":250,\"index\":",out);fprintf(out,"%d,\"read\":%d,\"list\":[",embedded_ix,embedded_read);
    for (int i=0;i<embedded_ix;i++) fprintf(out,"%s%u",i?",":"",embedded_list[i]);
    fputs("],\"values\":[",out);for (int i=0;i<N_EMBEDDED_VALUES;i++)fprintf(out,"%s%d",i?",":"",embedded_value[i]);
    fputs("]},\"phonemesHex\":",out);word_hex(out,word_phonemes);fputs(",\"phonemeList2\":",out);js_cw2_list(out);
}
static void js_cw2_context(const char *origin,char *buffer,size_t size,int word_index,int sub_index) {
    js_cw2_origin=origin;js_cw2_buffer=buffer;js_cw2_size=size;js_cw2_word_index=word_index;js_cw2_sub_index=sub_index;
}
static void js_cw2_event(FILE *out,const char *phase,unsigned long id,Translator *tr,char *word,WORD_TAB *wtab,int remaining,int pause) {
    fprintf(out,"{\"schemaVersion\":1,\"kind\":\"word2.%s\",\"clause\":%lu,\"id\":%lu,\"origin\":\"%s\",\"wordIndex\":%d,\"subIndex\":%d,\"offset\":%zu,\"remaining\":%d,\"prePauseArgument\":%d,\"bufferHex\":",
        phase,js_cw2_clause,id,js_cw2_origin,js_cw2_word_index,js_cw2_sub_index,(size_t)(word-js_cw2_buffer),remaining,pause);
    word_hex_bytes(out,js_cw2_buffer,js_cw2_size);fputs(",\"clauseBufferHex\":",out);word_hex_bytes(out,js_cw2_clause_buffer,js_cw2_clause_size);
    fputs(",\"words\":",out);word_wtab(out,wtab,remaining);fputc(',',out);js_cw2_state(out,tr,word);
}
static int TranslateWord2(Translator *tr,char *word,WORD_TAB *wtab,int remaining,int pause) {
    FILE *out=js_cw2_trace();if(!out)return js_original_TranslateWord2(tr,word,wtab,remaining,pause);
    unsigned long id=js_cw2_next_call++;
    js_cw2_event(out,"enter",id,tr,word,wtab,remaining,pause);js_cw2_flush(out);
    int flags=js_original_TranslateWord2(tr,word,wtab,remaining,pause);
    js_cw2_event(out,"exit",id,tr,word,wtab,remaining,pause);fprintf(out,",\"flags\":%u",(unsigned)flags);js_cw2_flush(out);return flags;
}
static void js_cw2_clause_words(Translator *tr,char *buffer,size_t size,WORD_TAB *words,int count,unsigned int source_index,int pause,int tone,bool sentence,int terminator,short *charix,int charix_top) {
    js_cw2_clause++;js_cw2_clause_buffer=buffer;js_cw2_clause_size=size;
    FILE *out=js_cw2_trace();if(!out)return;
    fprintf(out,"{\"schemaVersion\":1,\"kind\":\"clause.words\",\"clause\":%lu,\"bufferHex\":",js_cw2_clause);word_hex_bytes(out,buffer,size);
    fputs(",\"sourceHex\":",out);word_hex(out,source);fprintf(out,",\"wordCount\":%d,\"wordsWithSentinel\":",count);word_wtab(out,words,count+1);
    fprintf(out,",\"sourceIndex\":%u,\"clausePause\":%d,\"tone\":%d,\"terminator\":%u,\"newSentence2\":%s,\"charixTop\":%d,\"charix\":[",source_index,pause,tone,(unsigned)terminator,sentence?"true":"false",charix_top);
    for(int i=0;i<charix_top+4;i++)fprintf(out,"%s%d",i?",":"",charix[i]);
    fputs("],",out);js_cw2_state(out,tr,buffer+3);js_cw2_flush(out);
}
static void js_cw2_clause_final(Translator *tr,WORD_TAB *words,int count,unsigned int source_index,int pause,int tone,bool sentence,int terminator) {
    FILE *out=js_cw2_trace();if(!out)return;
    fprintf(out,"{\"schemaVersion\":1,\"kind\":\"clause.before-phonemelist\",\"clause\":%lu,\"bufferHex\":",js_cw2_clause);word_hex_bytes(out,js_cw2_clause_buffer,js_cw2_clause_size);
    fprintf(out,",\"wordCount\":%d,\"wordsWithSentinel\":",count);word_wtab(out,words,count+1);
    fprintf(out,",\"sourceIndex\":%u,\"clausePause\":%d,\"tone\":%d,\"terminator\":%u,\"newSentence2\":%s,",source_index,pause,tone,(unsigned)terminator,sentence?"true":"false");
    js_cw2_state(out,tr,js_cw2_clause_buffer+3);js_cw2_flush(out);
}
