#include "test.h"

int g_checks;
int g_failures;

void suite_abs(void);
void suite_uds(void);

int main(void)
{
    printf("abs\n");
    suite_abs();
    printf("uds\n");
    suite_uds();
    printf("%d checks, %d failures\n", g_checks, g_failures);
    return g_failures == 0 ? 0 : 1;
}
