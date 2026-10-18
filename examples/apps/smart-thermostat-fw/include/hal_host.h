/* Host-only hooks into the simulated board (used by unit tests). */
#ifndef CALORA_HAL_HOST_H
#define CALORA_HAL_HOST_H

#include <stddef.h>
#include <stdint.h>

void hal_host_reset(void);
void hal_host_set_log_level(int level);
void hal_host_set_sensors(int16_t temp_centi, uint8_t humidity, int presence);
void hal_host_set_http(const char *url, const uint8_t *data, size_t len);
void hal_host_push_ble(const char *data);
const char *hal_host_last_topic(void);
const char *hal_host_last_payload(void);
const char *hal_host_wifi_ssid(void);
int hal_host_boot_slot(void);
int hal_host_restarts(void);
const uint8_t *hal_host_slot_data(int slot);

#endif /* CALORA_HAL_HOST_H */
