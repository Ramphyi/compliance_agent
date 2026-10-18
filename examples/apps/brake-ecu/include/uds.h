/* UDS (ISO 14229) service and NRC constants used by the HBX-220. */
#ifndef HBX_UDS_H
#define HBX_UDS_H

#include <stdint.h>

#include "platform.h"

/* Services */
#define UDS_DIAGNOSTIC_SESSION_CONTROL 0x10
#define UDS_ECU_RESET                  0x11
#define UDS_READ_DATA_BY_ID            0x22
#define UDS_SECURITY_ACCESS            0x27
#define UDS_READ_DTC                   0x19
#define UDS_REQUEST_DOWNLOAD           0x34
#define UDS_TRANSFER_DATA              0x36
#define UDS_REQUEST_TRANSFER_EXIT      0x37

/* Negative response codes */
#define NRC_GENERAL_REJECT             0x10
#define NRC_SERVICE_NOT_SUPPORTED      0x11
#define NRC_SUBFUNCTION_NOT_SUPPORTED  0x12
#define NRC_CONDITIONS_NOT_CORRECT     0x22
#define NRC_REQUEST_SEQUENCE_ERROR     0x24
#define NRC_SECURITY_ACCESS_DENIED     0x33
#define NRC_INVALID_KEY                0x35

/* Sessions */
#define SESSION_DEFAULT     0x01
#define SESSION_PROGRAMMING 0x02
#define SESSION_EXTENDED    0x03

typedef struct {
    uint8_t session;
    int security_unlocked;
    uint32_t seed;
    uint32_t download_addr;
    uint32_t download_remaining;
    uint8_t block_seq;
} uds_state_t;

void uds_init(uds_state_t *s);
/* Handles one request frame; writes the response frame. Returns response length. */
int uds_handle(uds_state_t *s, const uint8_t *req, uint8_t req_len,
               uint8_t *resp, uint8_t resp_cap);

uint32_t uds_key_from_seed(uint32_t seed);

#endif /* HBX_UDS_H */
