/* HBX-220 platform interface. On target this is backed by the AUTOSAR MCAL
 * and COM stack; src/platform_host.c is the off-target stub. */
#ifndef HBX_PLATFORM_H
#define HBX_PLATFORM_H

#include <stddef.h>
#include <stdint.h>

typedef struct {
    uint32_t id;
    uint8_t dlc;
    uint8_t data[8];
} can_frame_t;

/* CAN */
int plt_can_send(const can_frame_t *frame);
int plt_can_recv(can_frame_t *frame); /* 1 if a frame was available, else 0 */

/* Time base, milliseconds since power-on */
uint32_t plt_time_ms(void);

/* Hydraulic actuator: per-wheel pressure demand, 0..250 (0.1 MPa units) */
void plt_actuator_set(uint8_t wheel, uint8_t pressure);

/* Application flash region used by the UDS download path */
int plt_flash_erase(uint32_t addr, uint32_t len);
int plt_flash_write(uint32_t addr, const uint8_t *data, uint32_t len);

/* Non-volatile diagnostic store */
int plt_nvm_read(uint16_t id, uint8_t *buf, size_t cap);
int plt_nvm_write(uint16_t id, const uint8_t *buf, size_t len);

#define WHEEL_FL 0
#define WHEEL_FR 1
#define WHEEL_RL 2
#define WHEEL_RR 3
#define WHEEL_COUNT 4

#endif /* HBX_PLATFORM_H */
