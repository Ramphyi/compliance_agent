/* Host implementation of the HAL: a simulated board for development builds
 * and unit tests. Time is virtual and advances in hal_delay_ms(). */
#include <stdarg.h>
#include <stdio.h>
#include <string.h>

#include "hal.h"
#include "hal_host.h"

#define NVS_SLOTS 16
#define SLOT_SIZE (16 * 1024)
#define HTTP_SLOTS 4

static uint32_t s_now;
static int s_log_level = 4;
static int16_t s_temp = 2000;
static uint8_t s_rh = 45;
static int s_presence;
static int s_relay;

static struct { char key[24]; char value[200]; int used; } s_nvs[NVS_SLOTS];
static uint8_t s_flash[2][SLOT_SIZE];
static int s_boot_slot, s_restarts;
static char s_ssid[64], s_topic[128], s_payload[256];
static struct { char url[128]; const uint8_t *data; size_t len; } s_http[HTTP_SLOTS];
static char s_ble[512];

void hal_host_reset(void)
{
    memset(s_nvs, 0, sizeof(s_nvs));
    memset(s_flash, 0xff, sizeof(s_flash));
    memset(s_http, 0, sizeof(s_http));
    s_boot_slot = 0;
    s_restarts = 0;
    s_ssid[0] = s_topic[0] = s_payload[0] = s_ble[0] = '\0';
}

void hal_host_set_log_level(int level) { s_log_level = level; }
void hal_host_set_sensors(int16_t t, uint8_t rh, int p) { s_temp = t; s_rh = rh; s_presence = p; }
void hal_host_push_ble(const char *data) { snprintf(s_ble, sizeof(s_ble), "%s", data); }
const char *hal_host_last_topic(void) { return s_topic; }
const char *hal_host_last_payload(void) { return s_payload; }
const char *hal_host_wifi_ssid(void) { return s_ssid; }
int hal_host_boot_slot(void) { return s_boot_slot; }
int hal_host_restarts(void) { return s_restarts; }
const uint8_t *hal_host_slot_data(int slot) { return s_flash[slot & 1]; }

void hal_host_set_http(const char *url, const uint8_t *data, size_t len)
{
    int i;
    for (i = 0; i < HTTP_SLOTS; i++) {
        if (s_http[i].url[0] == '\0' || strcmp(s_http[i].url, url) == 0) {
            snprintf(s_http[i].url, sizeof(s_http[i].url), "%s", url);
            s_http[i].data = data;
            s_http[i].len = len;
            return;
        }
    }
}

uint32_t hal_millis(void) { return s_now; }
void hal_delay_ms(uint32_t ms) { s_now += ms; }
int16_t hal_read_temp_centi(void) { return s_temp; }
uint8_t hal_read_humidity(void) { return s_rh; }
int hal_read_presence(void) { return s_presence; }
void hal_relay_set(int on) { s_relay = on; }

int hal_nvs_get(const char *key, char *out, size_t cap)
{
    int i;
    for (i = 0; i < NVS_SLOTS; i++)
        if (s_nvs[i].used && strcmp(s_nvs[i].key, key) == 0) {
            snprintf(out, cap, "%s", s_nvs[i].value);
            return HAL_OK;
        }
    return HAL_ERR;
}

int hal_nvs_set(const char *key, const char *value)
{
    int i, free_slot = -1;
    for (i = 0; i < NVS_SLOTS; i++) {
        if (s_nvs[i].used && strcmp(s_nvs[i].key, key) == 0)
            break;
        if (!s_nvs[i].used && free_slot < 0)
            free_slot = i;
    }
    if (i == NVS_SLOTS)
        i = free_slot;
    if (i < 0)
        return HAL_ERR;
    snprintf(s_nvs[i].key, sizeof(s_nvs[i].key), "%s", key);
    snprintf(s_nvs[i].value, sizeof(s_nvs[i].value), "%s", value);
    s_nvs[i].used = 1;
    return HAL_OK;
}

int hal_nvs_erase(const char *key)
{
    int i;
    for (i = 0; i < NVS_SLOTS; i++)
        if (s_nvs[i].used && strcmp(s_nvs[i].key, key) == 0)
            s_nvs[i].used = 0;
    return HAL_OK;
}

int hal_ota_inactive_slot(void) { return s_boot_slot ^ 1; }
int hal_flash_erase_slot(int slot) { memset(s_flash[slot & 1], 0xff, SLOT_SIZE); return HAL_OK; }
int hal_ota_set_boot_slot(int slot) { s_boot_slot = slot & 1; return HAL_OK; }
void hal_restart(void) { s_restarts++; }

int hal_flash_write(int slot, uint32_t offset, const uint8_t *data, size_t len)
{
    if (offset + len > SLOT_SIZE)
        return HAL_ERR;
    memcpy(&s_flash[slot & 1][offset], data, len);
    return HAL_OK;
}

int hal_wifi_connect(const char *ssid, const char *pass)
{
    (void)pass;
    snprintf(s_ssid, sizeof(s_ssid), "%s", ssid);
    return HAL_OK;
}

int hal_mqtt_connect(const char *uri, const char *client_id, const char *user, const char *pw)
{
    (void)uri; (void)client_id; (void)user; (void)pw;
    return HAL_OK;
}

int hal_mqtt_publish(const char *topic, const char *payload, int qos)
{
    (void)qos;
    snprintf(s_topic, sizeof(s_topic), "%s", topic);
    snprintf(s_payload, sizeof(s_payload), "%s", payload);
    return HAL_OK;
}

int hal_http_get(const char *url, uint32_t offset, uint8_t *buf, size_t cap)
{
    int i;
    for (i = 0; i < HTTP_SLOTS; i++) {
        if (strcmp(s_http[i].url, url) == 0) {
            size_t n;
            if (offset >= s_http[i].len)
                return 0;
            n = s_http[i].len - offset;
            if (n > cap)
                n = cap;
            memcpy(buf, s_http[i].data + offset, n);
            return (int)n;
        }
    }
    return HAL_ERR;
}

size_t hal_ble_prov_read(uint8_t *buf, size_t cap)
{
    size_t n = strlen(s_ble);
    if (n > cap)
        n = cap;
    memcpy(buf, s_ble, n);
    s_ble[0] = '\0';
    return n;
}

int hal_httpd_next(char *m, size_t mc, char *p, size_t pc, char *c, size_t cc)
{
    (void)m; (void)mc; (void)p; (void)pc; (void)c; (void)cc;
    return 0;
}

void hal_httpd_reply(int status, const char *content_type, const char *body)
{
    (void)status; (void)content_type; (void)body;
}

/* The host has no AES block; this stand-in only has to round-trip. */
int hal_aes128_cbc(const uint8_t key[16], const uint8_t iv[16], const uint8_t *in,
                   uint8_t *out, size_t len, int encrypt)
{
    uint8_t prev[16];
    size_t i;
    if (len % 16 != 0)
        return HAL_ERR;
    memcpy(prev, iv, 16);
    for (i = 0; i < len; i++) {
        uint8_t c = in[i];
        out[i] = encrypt ? (uint8_t)(c ^ prev[i % 16] ^ key[i % 16])
                         : (uint8_t)(c ^ key[i % 16] ^ prev[i % 16]);
        prev[i % 16] = encrypt ? out[i] : c;
    }
    return HAL_OK;
}

void hal_device_id(char *out, size_t cap) { snprintf(out, cap, "CT1-3C61A2F0"); }

void hal_log(int level, const char *tag, const char *fmt, ...)
{
    static const char lv[] = "?EWID";
    va_list ap;
    if (level > s_log_level)
        return;
    fprintf(stderr, "%c (%lu) %s: ", lv[(level >= 1 && level <= 4) ? level : 0],
            (unsigned long)s_now, tag);
    va_start(ap, fmt);
    vfprintf(stderr, fmt, ap);
    va_end(ap);
    fputc('\n', stderr);
}
