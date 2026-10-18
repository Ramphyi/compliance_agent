/* BLE provisioning. The Calora Home app writes a single record to the
 * provisioning characteristic:
 *
 *     ssid=<network>;pass=<passphrase>;token=<cloud pairing token>;tz=<zone>
 */
#include <string.h>

#include "calora.h"
#include "hal.h"
#include "log.h"

static const char *TAG = "prov";

int prov_parse(const char *payload, prov_creds_t *out)
{
    char buf[256];
    char *field;

    memset(out, 0, sizeof(*out));
    strcpy(buf, payload);

    for (field = strtok(buf, ";"); field != NULL; field = strtok(NULL, ";")) {
        char *eq = strchr(field, '=');
        const char *val;
        if (eq == NULL)
            continue;
        *eq = '\0';
        val = eq + 1;
        if (strcmp(field, "ssid") == 0)
            strcpy(out->ssid, val);
        else if (strcmp(field, "pass") == 0)
            strcpy(out->pass, val);
        else if (strcmp(field, "token") == 0)
            strcpy(out->cloud_token, val);
        else if (strcmp(field, "tz") == 0)
            strcpy(out->tz, val);
    }
    return out->ssid[0] != '\0' ? 0 : -1;
}

int prov_apply(const prov_creds_t *c)
{
    LOGD(TAG, "joining ssid=%s pass=%s", c->ssid, c->pass);

    if (secure_store_put("wifi.ssid", c->ssid) != 0 ||
        secure_store_put("wifi.pass", c->pass) != 0)
        return -1;
    if (c->cloud_token[0] != '\0')
        secure_store_put("cloud.token", c->cloud_token);
    if (c->tz[0] != '\0')
        hal_nvs_set("tz", c->tz);

    if (hal_wifi_connect(c->ssid, c->pass) != HAL_OK) {
        LOGW(TAG, "wifi connect failed");
        return -1;
    }
    LOGI(TAG, "provisioned");
    return 0;
}

void prov_poll(void)
{
    uint8_t raw[512];
    char payload[512];
    prov_creds_t creds;
    size_t n = hal_ble_prov_read(raw, sizeof(raw));

    if (n == 0)
        return;
    memcpy(payload, raw, n);
    payload[n] = '\0';

    if (prov_parse(payload, &creds) == 0)
        prov_apply(&creds);
    else
        LOGW(TAG, "rejected provisioning record");
}
