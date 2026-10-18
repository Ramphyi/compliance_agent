#ifndef HBX_DIAG_UTIL_H
#define HBX_DIAG_UTIL_H

#include <stdint.h>

uint16_t diag_block_sum(const uint8_t *data, uint32_t len);
uint8_t diag_rolling_counter(uint8_t prev);

#endif /* HBX_DIAG_UTIL_H */
