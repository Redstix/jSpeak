/* Export the actual private table, without copying its contents. */
#include "numbers.c"
#include "translateword.c"
int main(void) {
 printf("{\"schemaVersion\":1,\"constants\":{\"L_SUB\":%u,\"L_SUP\":%u},\"derivedLetters\":[",L_SUB,L_SUP);
 for(size_t i=0;i<sizeof(derived_letters)/sizeof(derived_letters[0]);i++)printf("%s%u",i?",":"",derived_letters[i]);
 fputs("],\"numberRanges\":[",stdout);
 for(size_t i=0;i<sizeof(number_ranges)/sizeof(number_ranges[0]);i++)printf("%s%d",i?",":"",number_ranges[i]);
 fputs("],\"hexLetters\":[",stdout);
 for(size_t i=0;i<sizeof(hex_letters)/sizeof(hex_letters[0]);i++)printf("%s\"%s\"",i?",":"",hex_letters[i]);
 fputs("],\"modifiers\":[",stdout);
 for(size_t i=0;i<sizeof(modifiers)/sizeof(modifiers[0]);i++){if(i)putchar(',');if(modifiers[i])printf("\"%s\"",modifiers[i]);else fputs("null",stdout);}
 puts("]}");return fflush(stdout)?74:0;
}
