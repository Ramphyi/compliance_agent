/* CAN transmit path for brake status and per-wheel pressure. */
#include <string.h>

#include "abs.h"
#include "can_ids.h"
#include "platform.h"

int can_tx_status(const brake_outputs_t *out)
{
    can_frame_t status;
    can_frame_t pressure;
    int rc = -1;
    int w;

    memset(&status, 0, sizeof(status));
    status.id = CAN_ID_BRAKE_STATUS;
    status.dlc = 2;
    for (w = 0; w < WHEEL_COUNT; w++)
        status.data[0] |= (uint8_t)(out->abs_active[w] << w);
    status.data[1] = 0x01; /* controller OK */

    if (plt_can_send(&status) != 0)
        goto fail;

    memset(&pressure, 0, sizeof(pressure));
    pressure.id = CAN_ID_WHEEL_PRESSURE;
    pressure.dlc = 4;
    for (w = 0; w < WHEEL_COUNT; w++)
        pressure.data[w] = out->pressure[w];

    if (plt_can_send(&pressure) != 0)
        goto fail;

    rc = 0;
fail:
    return rc;
}
