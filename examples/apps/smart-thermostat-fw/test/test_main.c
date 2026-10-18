#include "hal_host.h"
#include "test.h"

int g_checks;
int g_failures;

void suite_control(void);
void suite_net(void);

int main(void)
{
    hal_host_set_log_level(0);
    hal_host_reset();

    printf("control\n");
    suite_control();
    printf("network\n");
    suite_net();

    printf("%d checks, %d failures\n", g_checks, g_failures);
    return g_failures == 0 ? 0 : 1;
}
