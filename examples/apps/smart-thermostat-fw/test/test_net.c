#include <stdlib.h>

#include "calora.h"
#include "config.h"
#include "hal_host.h"
#include "test.h"

static void test_prov_parse(void)
{
    prov_creds_t c;
    CHECK(prov_parse("ssid=HomeNet;pass=hunter22;token=abc123;tz=Europe/London", &c) == 0);
    CHECK_STR(c.ssid, "HomeNet");
    CHECK_STR(c.pass, "hunter22");
    CHECK_STR(c.cloud_token, "abc123");
    CHECK_STR(c.tz, "Europe/London");
    CHECK(prov_parse("pass=only", &c) != 0);
}

static void test_prov_poll_connects(void)
{
    char pass[65];
    hal_host_reset();
    hal_host_push_ble("ssid=Flat 4B;pass=correct horse");
    prov_poll();
    CHECK_STR(hal_host_wifi_ssid(), "Flat 4B");
    CHECK(secure_store_get("wifi.pass", pass, sizeof(pass)) == 0);
    CHECK_STR(pass, "correct horse");
}

static void test_secure_store_roundtrip(void)
{
    char out[65];
    hal_host_reset();
    CHECK(secure_store_put("cloud.token", "tok_5f2a9c") == 0);
    CHECK(secure_store_get("cloud.token", out, sizeof(out)) == 0);
    CHECK_STR(out, "tok_5f2a9c");
    CHECK(secure_store_get("missing", out, sizeof(out)) != 0);
}

static void test_webcfg_login_and_status(void)
{
    thermostat_t t;
    char resp[1024], cookie[32];
    hal_host_reset();
    thermostat_init(&t);

    CHECK(webcfg_handle(&t, "GET", "/", "", resp, sizeof(resp)) == 401);
    CHECK(webcfg_handle(&t, "POST", "/login?user=admin&pass=wrong", "", resp, sizeof(resp)) == 401);
    CHECK(webcfg_handle(&t, "POST", "/login?user=admin&pass=" DEFAULT_ADMIN_PASSWORD, "", resp,
                        sizeof(resp)) == 200);
    snprintf(cookie, sizeof(cookie), "sid=%.8s", strstr(resp, "\":\"") + 3);
    CHECK(webcfg_handle(&t, "GET", "/set?sp=2150", cookie, resp, sizeof(resp)) == 200);
    CHECK(t.setpoint_centi == 2150);
    CHECK(webcfg_handle(&t, "GET", "/", cookie, resp, sizeof(resp)) == 200);
    CHECK(strstr(resp, "Target 21.50 C") != NULL);
}

static void test_telemetry_format(void)
{
    telemetry_sample_t s = { 2134, 48, 2050, 1, 1 };
    char topic[64], payload[192];
    hal_host_reset();
    telemetry_format(&s, "CT1-3C61A2F0", topic, payload);
    CHECK_STR(topic, "calora/t1/CT1-3C61A2F0/state");
    CHECK(strstr(payload, "\"t\":2134") != NULL);
    CHECK(strstr(payload, "\"heat\":1") != NULL);
    CHECK(telemetry_publish(&s) == 0);
    CHECK_STR(hal_host_last_topic(), "calora/t1/CT1-3C61A2F0/state");
}

static void test_ota_manifest(void)
{
    ota_manifest_t m;
    CHECK(ota_parse_manifest("version=2.4.2;file=t1-2.4.2.bin;size=4096;sha256=ab12", &m) == 0);
    CHECK_STR(m.version, "2.4.2");
    CHECK_STR(m.file, "t1-2.4.2.bin");
    CHECK(m.size == 4096);
    CHECK(ota_parse_manifest("version=2.4.2", &m) != 0);
}

static void test_ota_installs_new_image(void)
{
    static const char manifest[] = "version=2.4.2;file=t1-2.4.2.bin;size=3000;sha256=00";
    static uint8_t image[3000];
    size_t i;
    for (i = 0; i < sizeof(image); i++)
        image[i] = (uint8_t)(i * 7);

    hal_host_reset();
    hal_host_set_http(OTA_BASE_URL "/manifest.txt", (const uint8_t *)manifest, sizeof(manifest) - 1);
    hal_host_set_http(OTA_BASE_URL "/t1-2.4.2.bin", image, sizeof(image));

    CHECK(ota_check_and_apply("2.4.2") == 0);
    CHECK(hal_host_restarts() == 0);
    CHECK(ota_check_and_apply("2.4.1") == 1);
    CHECK(hal_host_boot_slot() == 1);
    CHECK(hal_host_restarts() == 1);
    CHECK(memcmp(hal_host_slot_data(1), image, sizeof(image)) == 0);
}

void suite_net(void)
{
    RUN(test_prov_parse);
    RUN(test_prov_poll_connects);
    RUN(test_secure_store_roundtrip);
    RUN(test_webcfg_login_and_status);
    RUN(test_telemetry_format);
    RUN(test_ota_manifest);
    RUN(test_ota_installs_new_image);
}
