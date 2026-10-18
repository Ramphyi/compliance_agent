#include "abs.h"
#include "can_ids.h"
#include "platform_host.h"
#include "test.h"

static can_frame_t mkframe(uint32_t id, const uint8_t *d, uint8_t dlc)
{
    can_frame_t f;
    memset(&f, 0, sizeof(f));
    f.id = id;
    f.dlc = dlc;
    memcpy(f.data, d, dlc);
    return f;
}

static void test_slip(void)
{
    CHECK(abs_slip_percent(0, 0) == 0);
    CHECK(abs_slip_percent(1280, 1280) == 0);
    CHECK(abs_slip_percent(1280, 1088) == 15);
    CHECK(abs_slip_percent(1280, 640) == 50);
}

static void test_decode_wheel_speed(void)
{
    uint8_t d[8] = { 0x02, 0x00, 0x02, 0x00, 0x02, 0x00, 0x01, 0x80 };
    abs_ctx_t c;
    can_frame_t f = mkframe(CAN_ID_WHEEL_SPEED, d, 8);
    abs_init(&c);
    CHECK(abs_on_frame(&c, &f, 10) == 1);
    CHECK(c.in.wheel_speed[WHEEL_FL] == 0x0200);
    CHECK(c.in.wheel_speed[WHEEL_RR] == 0x0180);
    CHECK(c.in.wheel_valid[WHEEL_RR] == 1);
}

static void test_abs_releases_on_lock(void)
{
    abs_ctx_t c;
    brake_outputs_t out;
    uint8_t ws[8] = { 0x05, 0x00, 0x05, 0x00, 0x05, 0x00, 0x05, 0x00 };
    uint8_t vs[8] = { 0x05, 0x00, 0, 0, 0, 0, 0, 0 };
    uint8_t pd[8] = { 150, 0x01, 0, 0, 0, 0, 0, 0 };
    can_frame_t fws = mkframe(CAN_ID_WHEEL_SPEED, ws, 8);
    can_frame_t fvs = mkframe(CAN_ID_VEHICLE_STATE, vs, 8);
    can_frame_t fpd = mkframe(CAN_ID_BRAKE_PEDAL, pd, 8);
    int i;

    abs_init(&c);
    memset(&out, 0, sizeof(out));
    abs_on_frame(&c, &fvs, 0);
    abs_on_frame(&c, &fpd, 0);
    abs_on_frame(&c, &fws, 0);

    /* wheels turning with vehicle: pressure builds */
    for (i = 0; i < 20; i++)
        abs_step(&c, &out);
    CHECK(out.pressure[WHEEL_FL] == 250);

    /* front-left locks (speed drops to zero): pressure released */
    ws[0] = 0x00; ws[1] = 0x00;
    fws = mkframe(CAN_ID_WHEEL_SPEED, ws, 8);
    abs_on_frame(&c, &fws, 10);
    abs_step(&c, &out);
    CHECK(out.pressure[WHEEL_FL] < 250);
    CHECK(out.abs_active[WHEEL_FL] == 1);
}

void suite_abs(void)
{
    plt_host_reset();
    RUN(test_slip);
    RUN(test_decode_wheel_speed);
    RUN(test_abs_releases_on_lock);
}
