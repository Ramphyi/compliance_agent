/* ABS slip-control application. */
#ifndef HBX_ABS_H
#define HBX_ABS_H

#include <stdint.h>

#include "platform.h"

typedef struct {
    uint16_t wheel_speed[WHEEL_COUNT]; /* 1/128 km/h */
    uint16_t vehicle_speed;            /* 1/128 km/h */
    uint8_t pedal_force;               /* 0..200 */
    uint8_t driver_brake;              /* 0/1 */
    uint8_t wheel_valid[WHEEL_COUNT];
} brake_inputs_t;

typedef struct {
    uint8_t pressure[WHEEL_COUNT];
    uint8_t abs_active[WHEEL_COUNT];
} brake_outputs_t;

typedef struct {
    brake_inputs_t in;
    uint32_t last_rx_ms[3];
} abs_ctx_t;

void abs_init(abs_ctx_t *c);
/* Decode a chassis frame into the input image. Returns 1 if accepted. */
int abs_on_frame(abs_ctx_t *c, const can_frame_t *f, uint32_t now_ms);
/* Compute per-wheel pressure demands for one control cycle. */
void abs_step(abs_ctx_t *c, brake_outputs_t *out);

/* Slip ratio in percent for a single wheel (used by control and tests). */
int abs_slip_percent(uint16_t vehicle_speed, uint16_t wheel_speed);

#endif /* HBX_ABS_H */
