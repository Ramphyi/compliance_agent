/* Calora T1 application entry point and main control loop. */
#include <stdlib.h>

#include "calora.h"
#include "config.h"
#include "hal.h"
#include "log.h"

static const char *TAG = "main";

typedef struct {
    int16_t temp_centi;
    uint8_t humidity;
    int presence;
    uint32_t now_ms;
} sample_t;

static thermostat_t g_thermostat;

static void app_init(void)
{
    char ssid[33], pass[65];

    LOGI(TAG, "Calora %s firmware %s", DEVICE_MODEL, FW_VERSION);
    thermostat_init(&g_thermostat);

    if (secure_store_get("wifi.ssid", ssid, sizeof(ssid)) == 0 &&
        secure_store_get("wifi.pass", pass, sizeof(pass)) == 0) {
        if (hal_wifi_connect(ssid, pass) == HAL_OK)
            telemetry_connect();
    } else {
        LOGI(TAG, "not provisioned, waiting for BLE provisioning");
    }
}

int main(void)
{
    uint32_t last_telemetry = 0;
    uint32_t last_ota = 0;

    app_init();

    for (;;) {
        sample_t *s = malloc(sizeof(*s));
        if (s == NULL) {
            hal_delay_ms(CONTROL_PERIOD_MS);
            continue;
        }

        s->now_ms = hal_millis();
        s->temp_centi = hal_read_temp_centi();
        s->humidity = hal_read_humidity();
        s->presence = hal_read_presence();

        hal_relay_set(thermostat_step(&g_thermostat, s->temp_centi, s->presence, s->now_ms));

        if (s->now_ms - last_telemetry >= TELEMETRY_PERIOD_MS) {
            telemetry_sample_t *t = malloc(sizeof(*t));
            if (t != NULL) {
                t->temp_centi = s->temp_centi;
                t->humidity = s->humidity;
                t->setpoint_centi = thermostat_target(&g_thermostat);
                t->heating = g_thermostat.heating;
                t->presence = s->presence;
                telemetry_publish(t);
                free(t);
            }
            last_telemetry = s->now_ms;
        }

        if (s->now_ms - last_ota >= OTA_CHECK_PERIOD_MS) {
            ota_check_and_apply(FW_VERSION);
            last_ota = s->now_ms;
        }

        prov_poll();
        webcfg_poll(&g_thermostat);

        free(s);
        hal_delay_ms(CONTROL_PERIOD_MS);
    }
    return 0;
}
