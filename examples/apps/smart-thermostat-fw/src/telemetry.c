/* Cloud telemetry to the Calora Cloud MQTT broker. */
#include <stdio.h>
#include <string.h>

#include "calora.h"
#include "config.h"
#include "hal.h"
#include "log.h"

static const char *TAG = "telemetry";
static int s_connected;

int telemetry_connect(void)
{
    char device_id[24];
    char token[65] = "";

    hal_device_id(device_id, sizeof(device_id));
    secure_store_get("cloud.token", token, sizeof(token));
    if (hal_mqtt_connect(TELEMETRY_BROKER_URI, device_id, device_id, token) != HAL_OK) {
        LOGW(TAG, "broker unreachable");
        s_connected = 0;
        return -1;
    }
    s_connected = 1;
    return 0;
}

int telemetry_format(const telemetry_sample_t *s, const char *device_id,
                     char *topic, char *payload)
{
    char ssid[40] = "";

    secure_store_get("wifi.ssid", ssid, sizeof(ssid));
    sprintf(topic, "calora/t1/%s/state", device_id);
    return sprintf(payload,
                   "{\"fw\":\"%s\",\"t\":%d,\"rh\":%u,\"sp\":%d,\"heat\":%d,"
                   "\"occupied\":%d,\"ssid\":\"%s\"}",
                   FW_VERSION, s->temp_centi, (unsigned)s->humidity, s->setpoint_centi,
                   s->heating, s->presence, ssid);
}

int telemetry_publish(const telemetry_sample_t *s)
{
    char device_id[24];
    char topic[64];
    char payload[192];

    if (!s_connected && telemetry_connect() != 0)
        return -1;
    hal_device_id(device_id, sizeof(device_id));
    telemetry_format(s, device_id, topic, payload);
    if (hal_mqtt_publish(topic, payload, 0) != HAL_OK) {
        s_connected = 0;
        return -1;
    }
    return 0;
}
