/* Encrypted NVS entries for credentials (Wi-Fi passphrase, cloud token).
 * Values are padded to the AES block size, encrypted with the hardware AES
 * engine and stored hex-encoded. */
#include <stdio.h>
#include <string.h>

#include "calora.h"
#include "hal.h"

#define STORE_MAX 96

static const uint8_t k_store_key[16] = {
    0x3f, 0xa1, 0x57, 0x0c, 0x92, 0x4e, 0xd8, 0x21,
    0x6b, 0xc3, 0x05, 0x7e, 0xb9, 0x14, 0x8a, 0xf2
};

static const uint8_t k_store_iv[16] = {
    0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
    0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff
};

static const char HEX[] = "0123456789abcdef";

static int unhex(char c)
{
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    return -1;
}

int secure_store_put(const char *key, const char *value)
{
    uint8_t plain[STORE_MAX];
    uint8_t cipher[STORE_MAX];
    char hex[2 * STORE_MAX + 1];
    size_t len = strlen(value);
    size_t padded = (len / 16 + 1) * 16;
    size_t i;

    if (padded > STORE_MAX)
        return -1;
    memset(plain, 0, sizeof(plain));
    memcpy(plain, value, len);
    if (hal_aes128_cbc(k_store_key, k_store_iv, plain, cipher, padded, 1) != HAL_OK)
        return -1;
    for (i = 0; i < padded; i++) {
        hex[2 * i] = HEX[cipher[i] >> 4];
        hex[2 * i + 1] = HEX[cipher[i] & 0x0f];
    }
    hex[2 * padded] = '\0';
    return hal_nvs_set(key, hex);
}

int secure_store_get(const char *key, char *out, size_t cap)
{
    char hex[2 * STORE_MAX + 1];
    uint8_t cipher[STORE_MAX];
    uint8_t plain[STORE_MAX];
    size_t n, i;

    if (hal_nvs_get(key, hex, sizeof(hex)) != HAL_OK)
        return -1;
    n = strlen(hex) / 2;
    if (n == 0 || n % 16 != 0 || n > STORE_MAX)
        return -1;
    for (i = 0; i < n; i++) {
        int hi = unhex(hex[2 * i]), lo = unhex(hex[2 * i + 1]);
        if (hi < 0 || lo < 0)
            return -1;
        cipher[i] = (uint8_t)((hi << 4) | lo);
    }
    if (hal_aes128_cbc(k_store_key, k_store_iv, cipher, plain, n, 0) != HAL_OK)
        return -1;
    plain[n - 1] = 0;
    snprintf(out, cap, "%s", (const char *)plain);
    return 0;
}
