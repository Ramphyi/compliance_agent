/* Over-the-air firmware updates.
 *
 * The update server publishes <base>/manifest.txt:
 *     version=2.4.2;file=t1-2.4.2.bin;size=1478656;sha256=<hex>
 * The image is streamed into the inactive OTA slot and the device reboots
 * into it. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "calora.h"
#include "config.h"
#include "hal.h"
#include "log.h"

static const char *TAG = "ota";

#define OTA_CHUNK 1024

int ota_parse_manifest(const char *text, ota_manifest_t *m)
{
    char buf[192];
    char *field;

    memset(m, 0, sizeof(*m));
    snprintf(buf, sizeof(buf), "%s", text);
    for (field = strtok(buf, ";\n"); field != NULL; field = strtok(NULL, ";\n")) {
        char *eq = strchr(field, '=');
        if (eq == NULL)
            continue;
        *eq++ = '\0';
        if (strcmp(field, "version") == 0)
            snprintf(m->version, sizeof(m->version), "%s", eq);
        else if (strcmp(field, "file") == 0)
            snprintf(m->file, sizeof(m->file), "%s", eq);
        else if (strcmp(field, "sha256") == 0)
            snprintf(m->sha256, sizeof(m->sha256), "%s", eq);
        else if (strcmp(field, "size") == 0)
            m->size = (uint32_t)strtoul(eq, NULL, 10);
    }
    return (m->version[0] && m->file[0] && m->size > 0) ? 0 : -1;
}

int ota_check_and_apply(const char *current_version)
{
    char url[128];
    char text[192];
    uint8_t chunk[OTA_CHUNK];
    ota_manifest_t m;
    uint32_t offset = 0;
    int slot, n;

    snprintf(url, sizeof(url), "%s/manifest.txt", OTA_BASE_URL);
    n = hal_http_get(url, 0, (uint8_t *)text, sizeof(text) - 1);
    if (n <= 0)
        return -1;
    text[n] = '\0';
    if (ota_parse_manifest(text, &m) != 0) {
        LOGW(TAG, "bad manifest");
        return -1;
    }
    if (strcmp(m.version, current_version) == 0)
        return 0;

    LOGI(TAG, "updating %s -> %s", current_version, m.version);
    slot = hal_ota_inactive_slot();
    if (hal_flash_erase_slot(slot) != HAL_OK)
        return -1;

    snprintf(url, sizeof(url), "%s/%s", OTA_BASE_URL, m.file);
    while ((n = hal_http_get(url, offset, chunk, sizeof(chunk))) > 0) {
        if (hal_flash_write(slot, offset, chunk, (size_t)n) != HAL_OK)
            return -1;
        offset += (uint32_t)n;
    }
    if (n < 0 || offset != m.size) {
        LOGE(TAG, "download incomplete (%lu of %lu)", (unsigned long)offset,
             (unsigned long)m.size);
        return -1;
    }

    if (hal_ota_set_boot_slot(slot) != HAL_OK)
        return -1;
    LOGI(TAG, "update installed, restarting");
    hal_restart();
    return 1;
}
