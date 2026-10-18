/* Application module interfaces for the Calora T1. */
#ifndef CALORA_APP_H
#define CALORA_APP_H

#include <stddef.h>
#include <stdint.h>

/* ---- thermostat.c: heating control ---- */
typedef enum { MODE_OFF = 0, MODE_HEAT, MODE_AUTO } thermo_mode_t;

typedef struct {
    int16_t setpoint_centi;
    int16_t away_setpoint_centi;
    thermo_mode_t mode;
    int heating;
    int away;
    uint32_t last_switch_ms;
    uint32_t last_presence_ms;
} thermostat_t;

void thermostat_init(thermostat_t *t);
int thermostat_set_setpoint(thermostat_t *t, int16_t centi);
int16_t thermostat_target(const thermostat_t *t);
int thermostat_step(thermostat_t *t, int16_t temp_centi, int presence, uint32_t now_ms);

/* ---- provision.c: BLE Wi-Fi provisioning ---- */
typedef struct {
    char ssid[33];
    char pass[65];
    char cloud_token[65];
    char tz[32];
} prov_creds_t;

int prov_parse(const char *payload, prov_creds_t *out);
int prov_apply(const prov_creds_t *c);
void prov_poll(void);

/* ---- secure_store.c: encrypted NVS entries ---- */
int secure_store_put(const char *key, const char *value);
int secure_store_get(const char *key, char *out, size_t cap);

/* ---- webcfg.c: local configuration page ---- */
int webcfg_login(const char *user, const char *pass, char *session_out, size_t cap);
int webcfg_handle(thermostat_t *t, const char *method, const char *path,
                  const char *cookie, char *resp, size_t cap);
void webcfg_poll(thermostat_t *t);
void webcfg_factory_reset(thermostat_t *t);

/* ---- telemetry.c: cloud telemetry ---- */
typedef struct {
    int16_t temp_centi;
    uint8_t humidity;
    int16_t setpoint_centi;
    int heating;
    int presence;
} telemetry_sample_t;

int telemetry_connect(void);
int telemetry_format(const telemetry_sample_t *s, const char *device_id,
                     char *topic, char *payload);
int telemetry_publish(const telemetry_sample_t *s);

/* ---- ota.c: firmware updates ---- */
typedef struct {
    char version[16];
    char file[48];
    char sha256[65];
    uint32_t size;
} ota_manifest_t;

int ota_parse_manifest(const char *text, ota_manifest_t *m);
int ota_check_and_apply(const char *current_version);

#endif /* CALORA_APP_H */
