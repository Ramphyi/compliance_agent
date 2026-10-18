#ifndef HBX_SCHEDULER_H
#define HBX_SCHEDULER_H

#include <stdint.h>

void sched_init(void);
void sched_cycle(uint32_t now_ms);
void sched_run(uint32_t cycles);
uint16_t sched_calibration_sum(const uint8_t *cal, uint32_t len);

#endif /* HBX_SCHEDULER_H */
