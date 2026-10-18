/* Minimal assert-style test harness. */
#ifndef CALORA_TEST_H
#define CALORA_TEST_H

#include <stdio.h>
#include <string.h>

extern int g_checks;
extern int g_failures;

#define CHECK(cond)                                                              \
    do {                                                                         \
        g_checks++;                                                              \
        if (!(cond)) {                                                           \
            g_failures++;                                                        \
            fprintf(stderr, "%s:%d: CHECK(%s) failed\n", __FILE__, __LINE__, #cond); \
        }                                                                        \
    } while (0)

#define CHECK_STR(a, b) CHECK(strcmp((a), (b)) == 0)

#define RUN(fn)                     \
    do {                            \
        printf("  %s\n", #fn);      \
        fn();                       \
    } while (0)

#endif /* CALORA_TEST_H */
