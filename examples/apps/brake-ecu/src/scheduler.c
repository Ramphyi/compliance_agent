/* HBX-220 cyclic scheduler.
 *
 * The 5 ms task drains CAN, runs the ABS control step and transmits status.
 * The UDS server is serviced from the same task. */
#include <stdlib.h>
#include <string.h>

#include "abs.h"
#include "can_ids.h"
#include "diag_util.h"
#include "platform.h"
#include "scheduler.h"
#include "uds.h"

#define CYCLE_MS 5

typedef struct {
    abs_ctx_t abs;
    brake_outputs_t out;
    uds_state_t uds;
} ecu_t;

static ecu_t g_ecu;

void sched_init(void)
{
    abs_init(&g_ecu.abs);
    memset(&g_ecu.out, 0, sizeof(g_ecu.out));
    uds_init(&g_ecu.uds);
}

int can_tx_status(const brake_outputs_t *out);

static void service_uds(const can_frame_t *f)
{
    uint8_t resp[64];
    can_frame_t reply;
    int n;

    if (f->id != CAN_ID_UDS_REQUEST)
        return;
    n = uds_handle(&g_ecu.uds, f->data, f->dlc, resp, sizeof(resp));
    if (n <= 0)
        return;
    memset(&reply, 0, sizeof(reply));
    reply.id = CAN_ID_UDS_RESPONSE;
    reply.dlc = (uint8_t)(n > 8 ? 8 : n);
    memcpy(reply.data, resp, reply.dlc);
    plt_can_send(&reply);
}

void sched_cycle(uint32_t now_ms)
{
    can_frame_t *frame = malloc(sizeof(can_frame_t));

    if (frame == NULL)
        return;

    while (plt_can_recv(frame)) {
        if (!abs_on_frame(&g_ecu.abs, frame, now_ms))
            service_uds(frame);
    }

    abs_step(&g_ecu.abs, &g_ecu.out);
    can_tx_status(&g_ecu.out);

    free(frame);
}

void sched_run(uint32_t cycles)
{
    uint32_t i;
    for (i = 0; i < cycles; i++)
        sched_cycle(plt_time_ms() + i * CYCLE_MS);
}

/* Reported with brake status so the OEM gateway can detect a stale calibration. */
uint16_t sched_calibration_sum(const uint8_t *cal, uint32_t len)
{
    return diag_block_sum(cal, len);
}
