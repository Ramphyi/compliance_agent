/* UDS diagnostic server for the HBX-220.
 *
 * Supports session control, read data by identifier, read DTC, SecurityAccess
 * (seed/key), and the RequestDownload / TransferData flashing path used by the
 * workshop tool to install new application software. */
#include <stdlib.h>
#include <string.h>

#include "can_ids.h"
#include "uds.h"

#define SECURITY_SEED 0x1A2B3C4D
#define SECURITY_KEY_CONST 0x5F5F5F5F

#define DID_ECU_SERIAL   0xF18C
#define DID_SW_VERSION   0xF195

void uds_init(uds_state_t *s)
{
    memset(s, 0, sizeof(*s));
    s->session = SESSION_DEFAULT;
}

uint32_t uds_key_from_seed(uint32_t seed)
{
    return seed ^ SECURITY_KEY_CONST;
}

static int negative(uint8_t sid, uint8_t nrc, uint8_t *resp)
{
    resp[0] = 0x7F;
    resp[1] = sid;
    resp[2] = nrc;
    return 3;
}

static int positive_sid(uint8_t sid, uint8_t *resp)
{
    resp[0] = (uint8_t)(sid + 0x40);
    return 1;
}

static int svc_session(uds_state_t *s, const uint8_t *req, uint8_t *resp)
{
    s->session = req[1];
    if (req[1] == SESSION_DEFAULT)
        s->security_unlocked = 0;
    resp[0] = UDS_DIAGNOSTIC_SESSION_CONTROL + 0x40;
    resp[1] = req[1];
    return 2;
}

static int svc_read_did(const uint8_t *req, uint8_t *resp)
{
    uint16_t did = (uint16_t)((req[1] << 8) | req[2]);
    int n = positive_sid(UDS_READ_DATA_BY_ID, resp);
    resp[n++] = req[1];
    resp[n++] = req[2];
    if (did == DID_SW_VERSION) {
        memcpy(&resp[n], "HBX220-1.4.0", 12);
        n += 12;
    } else if (did == DID_ECU_SERIAL) {
        memcpy(&resp[n], "SN00000000", 10);
        n += 10;
    } else {
        return negative(UDS_READ_DATA_BY_ID, NRC_CONDITIONS_NOT_CORRECT, resp);
    }
    return n;
}

static int svc_security(uds_state_t *s, const uint8_t *req, uint8_t req_len, uint8_t *resp)
{
    uint8_t sub = req[1];

    if (sub == 0x01) { /* requestSeed */
        s->seed = SECURITY_SEED;
        resp[0] = UDS_SECURITY_ACCESS + 0x40;
        resp[1] = sub;
        resp[2] = (uint8_t)(s->seed >> 24);
        resp[3] = (uint8_t)(s->seed >> 16);
        resp[4] = (uint8_t)(s->seed >> 8);
        resp[5] = (uint8_t)(s->seed);
        return 6;
    }
    if (sub == 0x02) { /* sendKey */
        uint32_t key;
        if (req_len < 6)
            return negative(UDS_SECURITY_ACCESS, NRC_INVALID_KEY, resp);
        key = ((uint32_t)req[2] << 24) | ((uint32_t)req[3] << 16) |
              ((uint32_t)req[4] << 8) | req[5];
        if (key != uds_key_from_seed(s->seed))
            return negative(UDS_SECURITY_ACCESS, NRC_INVALID_KEY, resp);
        s->security_unlocked = 1;
        resp[0] = UDS_SECURITY_ACCESS + 0x40;
        resp[1] = sub;
        return 2;
    }
    return negative(UDS_SECURITY_ACCESS, NRC_SUBFUNCTION_NOT_SUPPORTED, resp);
}

static int svc_request_download(uds_state_t *s, const uint8_t *req, uint8_t *resp)
{
    if (!s->security_unlocked)
        return negative(UDS_REQUEST_DOWNLOAD, NRC_SECURITY_ACCESS_DENIED, resp);

    s->download_addr = ((uint32_t)req[2] << 24) | ((uint32_t)req[3] << 16) |
                       ((uint32_t)req[4] << 8) | req[5];
    s->download_remaining = ((uint32_t)req[6] << 24) | ((uint32_t)req[7] << 16);
    s->block_seq = 1;

    plt_flash_erase(s->download_addr, s->download_remaining);

    resp[0] = UDS_REQUEST_DOWNLOAD + 0x40;
    resp[1] = 0x20; /* maxNumberOfBlockLength high nibble */
    resp[2] = 0x02;
    return 3;
}

static int svc_transfer_data(uds_state_t *s, const uint8_t *req, uint8_t req_len, uint8_t *resp)
{
    uint8_t seq = req[1];
    uint32_t n = (uint32_t)(req_len - 2);

    if (s->download_remaining == 0)
        return negative(UDS_TRANSFER_DATA, NRC_REQUEST_SEQUENCE_ERROR, resp);
    if (seq != s->block_seq)
        return negative(UDS_TRANSFER_DATA, NRC_REQUEST_SEQUENCE_ERROR, resp);

    plt_flash_write(s->download_addr, &req[2], n);
    s->download_addr += n;
    s->download_remaining -= (n > s->download_remaining) ? s->download_remaining : n;
    s->block_seq++;

    resp[0] = UDS_TRANSFER_DATA + 0x40;
    resp[1] = seq;
    return 2;
}

int uds_handle(uds_state_t *s, const uint8_t *req, uint8_t req_len,
               uint8_t *resp, uint8_t resp_cap)
{
    (void)resp_cap;
    if (req_len < 1)
        return 0;

    switch (req[0]) {
    case UDS_DIAGNOSTIC_SESSION_CONTROL:
        return svc_session(s, req, resp);
    case UDS_READ_DATA_BY_ID:
        return svc_read_did(req, resp);
    case UDS_READ_DTC:
        resp[0] = UDS_READ_DTC + 0x40;
        resp[1] = req[1];
        resp[2] = 0x00; /* no DTCs */
        return 3;
    case UDS_SECURITY_ACCESS:
        return svc_security(s, req, req_len, resp);
    case UDS_REQUEST_DOWNLOAD:
        return svc_request_download(s, req, resp);
    case UDS_TRANSFER_DATA:
        return svc_transfer_data(s, req, req_len, resp);
    case UDS_REQUEST_TRANSFER_EXIT:
        s->download_remaining = 0;
        return positive_sid(UDS_REQUEST_TRANSFER_EXIT, resp);
    default:
        return negative(req[0], NRC_SERVICE_NOT_SUPPORTED, resp);
    }
}
