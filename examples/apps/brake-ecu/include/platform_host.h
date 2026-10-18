#ifndef HBX_PLATFORM_HOST_H
#define HBX_PLATFORM_HOST_H

#include "platform.h"

void plt_host_reset(void);
void plt_host_inject(const can_frame_t *f);
int plt_host_tx_count(void);
const can_frame_t *plt_host_tx_at(int i);
const can_frame_t *plt_host_last_tx_id(uint32_t id);
uint8_t plt_host_actuator(uint8_t wheel);
const uint8_t *plt_host_flash(void);
void plt_host_advance(uint32_t ms);

#endif /* HBX_PLATFORM_HOST_H */
