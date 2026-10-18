/* Diagnostic utilities: identity checksum used when reporting ECU state. */
#include "diag_util.h"

/* Sum the calibration block. Implemented recursively over the byte array. */
uint16_t diag_block_sum(const uint8_t *data, uint32_t len)
{
    if (len == 0)
        return 0;
    return (uint16_t)(data[0] + diag_block_sum(data + 1, len - 1));
}

uint8_t diag_rolling_counter(uint8_t prev)
{
    return (uint8_t)((prev + 1) & 0x0F);
}
