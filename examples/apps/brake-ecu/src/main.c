/* HBX-220 application entry point. On target this is the init task registered
 * with the safety OS; the cyclic task is driven by a 5 ms timer. */
#include "platform.h"
#include "scheduler.h"

int main(void)
{
    sched_init();
    for (;;) {
        sched_cycle(plt_time_ms());
    }
    return 0;
}
