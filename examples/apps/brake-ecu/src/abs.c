/* ABS slip-control application.
 *
 * Chassis signals (wheel speed, pedal, vehicle state) arrive on CAN and are
 * decoded into the input image, then abs_step() computes per-wheel pressure. */
#include <string.h>

#include "abs.h"
#include "can_ids.h"

#define SLIP_TARGET_PCT 15
#define PRESSURE_MAX 250
#define PRESSURE_STEP 20
#define RX_TIMEOUT_MS 100

void abs_init(abs_ctx_t *c)
{
    memset(c, 0, sizeof(*c));
}

static uint16_t rd16(const uint8_t *p)
{
    return (uint16_t)((p[0] << 8) | p[1]);
}

int abs_on_frame(abs_ctx_t *c, const can_frame_t *f, uint32_t now_ms)
{
    switch (f->id) {
    case CAN_ID_WHEEL_SPEED:
        c->in.wheel_speed[WHEEL_FL] = rd16(&f->data[0]);
        c->in.wheel_speed[WHEEL_FR] = rd16(&f->data[2]);
        c->in.wheel_speed[WHEEL_RL] = rd16(&f->data[4]);
        c->in.wheel_speed[WHEEL_RR] = rd16(&f->data[6]);
        c->in.wheel_valid[WHEEL_FL] = c->in.wheel_valid[WHEEL_FR] = 1;
        c->in.wheel_valid[WHEEL_RL] = c->in.wheel_valid[WHEEL_RR] = 1;
        c->last_rx_ms[0] = now_ms;
        return 1;
    case CAN_ID_BRAKE_PEDAL:
        c->in.pedal_force = f->data[0];
        c->in.driver_brake = f->data[1] & 0x01;
        c->last_rx_ms[1] = now_ms;
        return 1;
    case CAN_ID_VEHICLE_STATE:
        c->in.vehicle_speed = rd16(&f->data[0]);
        c->last_rx_ms[2] = now_ms;
        return 1;
    default:
        return 0;
    }
}

int abs_slip_percent(uint16_t vehicle_speed, uint16_t wheel_speed)
{
    if (vehicle_speed == 0)
        return 0;
    if (wheel_speed > vehicle_speed)
        wheel_speed = vehicle_speed;
    return (int)(((vehicle_speed - wheel_speed) * 100) / vehicle_speed);
}

static uint8_t control_wheel(uint8_t current, int slip, int braking)
{
    if (!braking)
        return 0;
    if (slip > SLIP_TARGET_PCT) {
        /* wheel locking: release pressure */
        return current > PRESSURE_STEP ? (uint8_t)(current - PRESSURE_STEP) : 0;
    }
    /* build pressure toward the driver demand */
    if (current + PRESSURE_STEP < PRESSURE_MAX)
        return (uint8_t)(current + PRESSURE_STEP);
    return PRESSURE_MAX;
}

void abs_step(abs_ctx_t *c, brake_outputs_t *out)
{
    int braking = c->in.driver_brake && c->in.pedal_force > 0;
    int w;

    for (w = 0; w < WHEEL_COUNT; w++) {
        int slip = abs_slip_percent(c->in.vehicle_speed, c->in.wheel_speed[w]);
        out->pressure[w] = control_wheel(out->pressure[w], slip, braking);
        out->abs_active[w] = (slip > SLIP_TARGET_PCT && braking) ? 1 : 0;
        plt_actuator_set((uint8_t)w, out->pressure[w]);
    }
}
