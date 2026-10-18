/*
 * Calora T1 hardware abstraction layer.
 *
 * One implementation per target: hal_host.c for host builds and unit tests,
 * hal_esp32s3.c in the board support package for the product.
 */
#ifndef CALORA_HAL_H
#define CALORA_HAL_H

#include <stddef.h>
#include <stdint.h>

#define HAL_OK 0
#define HAL_ERR (-1)

/* Time */
uint32_t hal_millis(void);
void hal_delay_ms(uint32_t ms);

/* Sensors and actuators */
int16_t hal_read_temp_centi(void); /* 0.01 degC */
uint8_t hal_read_humidity(void);   /* % RH */
int hal_read_presence(void);       /* PIR, 1 = motion in last minute */
void hal_relay_set(int on);

/* Non-volatile storage (NVS namespace "calora") */
int hal_nvs_get(const char *key, char *out, size_t cap);
int hal_nvs_set(const char *key, const char *value);
int hal_nvs_erase(const char *key);

/* OTA partitions */
int hal_ota_inactive_slot(void);
int hal_flash_erase_slot(int slot);
int hal_flash_write(int slot, uint32_t offset, const uint8_t *data, size_t len);
int hal_ota_set_boot_slot(int slot);
void hal_restart(void);

/* Networking */
int hal_wifi_connect(const char *ssid, const char *pass);
int hal_mqtt_connect(const char *uri, const char *client_id,
                     const char *username, const char *password);
int hal_mqtt_publish(const char *topic, const char *payload, int qos);
/* Reads up to cap bytes of url starting at offset. Returns bytes read,
 * 0 at end of resource, HAL_ERR on failure. */
int hal_http_get(const char *url, uint32_t offset, uint8_t *buf, size_t cap);

/* BLE provisioning characteristic: bytes written by the phone since last poll */
size_t hal_ble_prov_read(uint8_t *buf, size_t cap);

/* Local web server: next pending request, or 0 if none */
int hal_httpd_next(char *method, size_t mcap, char *path, size_t pcap,
                   char *cookie, size_t ccap);
void hal_httpd_reply(int status, const char *content_type, const char *body);

/* AES-128-CBC hardware accelerator */
int hal_aes128_cbc(const uint8_t key[16], const uint8_t iv[16],
                   const uint8_t *in, uint8_t *out, size_t len, int encrypt);

/* Device identity burned into eFuse at the factory */
void hal_device_id(char *out, size_t cap);

/* Debug console */
void hal_log(int level, const char *tag, const char *fmt, ...);

#endif /* CALORA_HAL_H */
