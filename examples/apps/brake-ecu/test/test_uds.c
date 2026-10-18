#include "can_ids.h"
#include "diag_util.h"
#include "platform.h"
#include "platform_host.h"
#include "scheduler.h"
#include "test.h"
#include "uds.h"

static void test_session_control(void)
{
    uds_state_t s;
    uint8_t req[] = { UDS_DIAGNOSTIC_SESSION_CONTROL, SESSION_PROGRAMMING };
    uint8_t resp[16];
    int n;
    uds_init(&s);
    n = uds_handle(&s, req, sizeof(req), resp, sizeof(resp));
    CHECK(n == 2);
    CHECK(resp[0] == 0x50);
    CHECK(s.session == SESSION_PROGRAMMING);
}

static void test_security_seed_key(void)
{
    uds_state_t s;
    uint8_t seed_req[] = { UDS_SECURITY_ACCESS, 0x01 };
    uint8_t key_req[6] = { UDS_SECURITY_ACCESS, 0x02 };
    uint8_t resp[16];
    uint32_t seed, key;
    int n;

    uds_init(&s);
    n = uds_handle(&s, seed_req, sizeof(seed_req), resp, sizeof(resp));
    CHECK(n == 6);
    seed = ((uint32_t)resp[2] << 24) | ((uint32_t)resp[3] << 16) |
           ((uint32_t)resp[4] << 8) | resp[5];
    key = uds_key_from_seed(seed);
    key_req[2] = (uint8_t)(key >> 24);
    key_req[3] = (uint8_t)(key >> 16);
    key_req[4] = (uint8_t)(key >> 8);
    key_req[5] = (uint8_t)key;
    n = uds_handle(&s, key_req, sizeof(key_req), resp, sizeof(resp));
    CHECK(n == 2);
    CHECK(s.security_unlocked == 1);
}

static void test_security_wrong_key(void)
{
    uds_state_t s;
    uint8_t seed_req[] = { UDS_SECURITY_ACCESS, 0x01 };
    uint8_t key_req[6] = { UDS_SECURITY_ACCESS, 0x02, 0, 0, 0, 0 };
    uint8_t resp[16];
    uds_init(&s);
    uds_handle(&s, seed_req, sizeof(seed_req), resp, sizeof(resp));
    uds_handle(&s, key_req, sizeof(key_req), resp, sizeof(resp));
    CHECK(resp[0] == 0x7F);
    CHECK(resp[2] == NRC_INVALID_KEY);
    CHECK(s.security_unlocked == 0);
}

static void test_download_requires_unlock(void)
{
    uds_state_t s;
    uint8_t dl[] = { UDS_REQUEST_DOWNLOAD, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x10 };
    uint8_t resp[16];
    uds_init(&s);
    uds_handle(&s, dl, sizeof(dl), resp, sizeof(resp));
    CHECK(resp[0] == 0x7F);
    CHECK(resp[2] == NRC_SECURITY_ACCESS_DENIED);
}

static void test_download_and_transfer(void)
{
    uds_state_t s;
    uint8_t resp[16];
    uint8_t dl[] = { UDS_REQUEST_DOWNLOAD, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x10 };
    uint8_t td[6] = { UDS_TRANSFER_DATA, 0x01, 0xDE, 0xAD, 0xBE, 0xEF };
    const uint8_t *flash;

    plt_host_reset();
    uds_init(&s);
    s.security_unlocked = 1;
    uds_handle(&s, dl, sizeof(dl), resp, sizeof(resp));
    CHECK(resp[0] == UDS_REQUEST_DOWNLOAD + 0x40);
    uds_handle(&s, td, sizeof(td), resp, sizeof(resp));
    CHECK(resp[0] == UDS_TRANSFER_DATA + 0x40);
    flash = plt_host_flash();
    CHECK(flash[0x100] == 0xDE && flash[0x103] == 0xEF);
}

static void test_scheduler_pipeline(void)
{
    uint8_t ws[8] = { 0x04, 0x00, 0x04, 0x00, 0x04, 0x00, 0x04, 0x00 };
    uint8_t vs[8] = { 0x04, 0x00, 0, 0, 0, 0, 0, 0 };
    uint8_t pd[8] = { 120, 0x01, 0, 0, 0, 0, 0, 0 };
    can_frame_t f;
    const can_frame_t *status;
    int i;

    plt_host_reset();
    sched_init();
    memset(&f, 0, sizeof(f));
    f.id = CAN_ID_VEHICLE_STATE; f.dlc = 8; memcpy(f.data, vs, 8); plt_host_inject(&f);
    f.id = CAN_ID_BRAKE_PEDAL; memcpy(f.data, pd, 8); plt_host_inject(&f);
    f.id = CAN_ID_WHEEL_SPEED; memcpy(f.data, ws, 8); plt_host_inject(&f);

    for (i = 0; i < 5; i++)
        sched_cycle(i * 5);

    status = plt_host_last_tx_id(CAN_ID_BRAKE_STATUS);
    CHECK(status != NULL);
    CHECK(status->data[1] == 0x01);
    CHECK(plt_host_actuator(WHEEL_FL) > 0);
}

static void test_diag_sum_and_counter(void)
{
    uint8_t cal[4] = { 1, 2, 3, 4 };
    CHECK(sched_calibration_sum(cal, 4) == 10);
    CHECK(diag_rolling_counter(0x0F) == 0x00);
    CHECK(diag_rolling_counter(3) == 4);
}

void suite_uds(void)
{
    RUN(test_session_control);
    RUN(test_security_seed_key);
    RUN(test_security_wrong_key);
    RUN(test_download_requires_unlock);
    RUN(test_download_and_transfer);
    RUN(test_scheduler_pipeline);
    RUN(test_diag_sum_and_counter);
}
