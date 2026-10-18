/* Local configuration page served on the home network (port 80). */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "calora.h"
#include "config.h"
#include "hal.h"
#include "log.h"

static const char *TAG = "webcfg";

static uint32_t s_session;
static int s_session_valid;

static int query_param(const char *path, const char *name, char *out, size_t cap)
{
    const char *q = strchr(path, '?');
    size_t nlen = strlen(name);

    while (q != NULL) {
        q++;
        if (strncmp(q, name, nlen) == 0 && q[nlen] == '=') {
            const char *v = q + nlen + 1;
            size_t i = 0;
            while (v[i] != '\0' && v[i] != '&' && i + 1 < cap) {
                out[i] = v[i];
                i++;
            }
            out[i] = '\0';
            return 0;
        }
        q = strchr(q, '&');
    }
    return -1;
}

int webcfg_login(const char *user, const char *pass, char *session_out, size_t cap)
{
    char stored[65];
    const char *expected = DEFAULT_ADMIN_PASSWORD;

    if (secure_store_get("admin.pass", stored, sizeof(stored)) == 0)
        expected = stored;
    if (strcmp(user, LOCAL_ADMIN_USER) != 0 || strcmp(pass, expected) != 0) {
        LOGW(TAG, "login failed for %s", user);
        return -1;
    }

    srand(hal_millis());
    s_session = ((uint32_t)rand() << 16) ^ (uint32_t)rand();
    s_session_valid = 1;
    snprintf(session_out, cap, "%08lx", (unsigned long)s_session);
    return 0;
}

static int session_ok(const char *cookie)
{
    const char *sid = cookie ? strstr(cookie, "sid=") : NULL;
    if (!s_session_valid || sid == NULL)
        return 0;
    return strtoul(sid + 4, NULL, 16) == s_session;
}

static void render_status(const thermostat_t *t, char *resp)
{
    char name[48] = "Calora T1";
    char ssid[40] = "";
    char line[64];
    int16_t target = thermostat_target(t);

    hal_nvs_get("device.name", name, sizeof(name));
    secure_store_get("wifi.ssid", ssid, sizeof(ssid));

    strcpy(resp, "<html><body><h1>");
    strcat(resp, name);
    strcat(resp, "</h1>");
    sprintf(line, "<p>Target %d.%02d C, boiler %s</p>", target / 100, target % 100,
            t->heating ? "on" : "off");
    strcat(resp, line);
    strcat(resp, "<p>Network: ");
    strcat(resp, ssid);
    strcat(resp, "</p><p>Firmware " FW_VERSION "</p></body></html>");
}

void webcfg_factory_reset(thermostat_t *t)
{
    thermostat_init(t);
    hal_nvs_erase("device.name");
    hal_nvs_erase("schedule");
    hal_nvs_erase("tz");
    s_session_valid = 0;
    LOGI(TAG, "factory reset complete");
}

int webcfg_handle(thermostat_t *t, const char *method, const char *path,
                  const char *cookie, char *resp, size_t cap)
{
    char value[64];

    if (strncmp(path, "/login", 6) == 0) {
        char user[32], pass[64], sid[16];
        if (query_param(path, "user", user, sizeof(user)) != 0 ||
            query_param(path, "pass", pass, sizeof(pass)) != 0 ||
            webcfg_login(user, pass, sid, sizeof(sid)) != 0)
            return 401;
        snprintf(resp, cap, "{\"session\":\"%s\"}", sid);
        return 200;
    }
    if (!session_ok(cookie))
        return 401;

    if (strcmp(path, "/") == 0) {
        render_status(t, resp);
        return 200;
    }
    if (strncmp(path, "/set", 4) == 0 && query_param(path, "sp", value, sizeof(value)) == 0) {
        if (thermostat_set_setpoint(t, (int16_t)atoi(value)) != 0)
            return 400;
        snprintf(resp, cap, "{\"setpoint\":%d}", t->setpoint_centi);
        return 200;
    }
    if (strncmp(path, "/name", 5) == 0 && query_param(path, "value", value, sizeof(value)) == 0) {
        hal_nvs_set("device.name", value);
        sprintf(resp, "{\"name\":\"%s\"}", value);
        return 200;
    }
    if (strcmp(method, "POST") == 0 && strcmp(path, "/reset") == 0) {
        webcfg_factory_reset(t);
        snprintf(resp, cap, "{\"reset\":true}");
        return 200;
    }
    return 404;
}

void webcfg_poll(thermostat_t *t)
{
    char method[8], path[160], cookie[64];
    char resp[1024];
    int status;

    if (!hal_httpd_next(method, sizeof(method), path, sizeof(path), cookie, sizeof(cookie)))
        return;
    resp[0] = '\0';
    status = webcfg_handle(t, method, path, cookie, resp, sizeof(resp));
    hal_httpd_reply(status, status == 200 && path[1] == '\0' ? "text/html" : "application/json",
                    resp);
}
