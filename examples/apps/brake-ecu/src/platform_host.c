/* Off-target platform stub. Provides an injectable CAN queue, a flat flash
 * image and an actuator capture so the control and diagnostic logic can be
 * tested on the host. */
#include <string.h>

#include "platform.h"
#include "platform_host.h"

#define RX_QUEUE 64
#define TX_QUEUE 64
#define FLASH_SIZE (64 * 1024)
#define NVM_SLOTS 16

static can_frame_t s_rx[RX_QUEUE];
static int s_rx_head, s_rx_tail;
static can_frame_t s_tx[TX_QUEUE];
static int s_tx_count;
static uint8_t s_flash[FLASH_SIZE];
static uint8_t s_actuator[WHEEL_COUNT];
static uint32_t s_now;
static struct { uint16_t id; uint8_t buf[32]; size_t len; int used; } s_nvm[NVM_SLOTS];

void plt_host_reset(void)
{
    s_rx_head = s_rx_tail = s_tx_count = 0;
    s_now = 0;
    memset(s_flash, 0xff, sizeof(s_flash));
    memset(s_actuator, 0, sizeof(s_actuator));
    memset(s_nvm, 0, sizeof(s_nvm));
}

void plt_host_inject(const can_frame_t *f)
{
    s_rx[s_rx_head] = *f;
    s_rx_head = (s_rx_head + 1) % RX_QUEUE;
}

int plt_host_tx_count(void) { return s_tx_count; }
const can_frame_t *plt_host_tx_at(int i) { return &s_tx[i]; }
uint8_t plt_host_actuator(uint8_t wheel) { return s_actuator[wheel & 3]; }
const uint8_t *plt_host_flash(void) { return s_flash; }
void plt_host_advance(uint32_t ms) { s_now += ms; }

const can_frame_t *plt_host_last_tx_id(uint32_t id)
{
    int i;
    for (i = s_tx_count - 1; i >= 0; i--)
        if (s_tx[i].id == id)
            return &s_tx[i];
    return NULL;
}

int plt_can_send(const can_frame_t *frame)
{
    if (s_tx_count >= TX_QUEUE)
        return -1;
    s_tx[s_tx_count++] = *frame;
    return 0;
}

int plt_can_recv(can_frame_t *frame)
{
    if (s_rx_tail == s_rx_head)
        return 0;
    *frame = s_rx[s_rx_tail];
    s_rx_tail = (s_rx_tail + 1) % RX_QUEUE;
    return 1;
}

uint32_t plt_time_ms(void) { return s_now; }

void plt_actuator_set(uint8_t wheel, uint8_t pressure)
{
    s_actuator[wheel & 3] = pressure;
}

int plt_flash_erase(uint32_t addr, uint32_t len)
{
    if (addr + len > FLASH_SIZE)
        return -1;
    memset(&s_flash[addr], 0xff, len);
    return 0;
}

int plt_flash_write(uint32_t addr, const uint8_t *data, uint32_t len)
{
    if (addr + len > FLASH_SIZE)
        return -1;
    memcpy(&s_flash[addr], data, len);
    return 0;
}

int plt_nvm_read(uint16_t id, uint8_t *buf, size_t cap)
{
    int i;
    for (i = 0; i < NVM_SLOTS; i++)
        if (s_nvm[i].used && s_nvm[i].id == id) {
            size_t n = s_nvm[i].len < cap ? s_nvm[i].len : cap;
            memcpy(buf, s_nvm[i].buf, n);
            return (int)n;
        }
    return -1;
}

int plt_nvm_write(uint16_t id, const uint8_t *buf, size_t len)
{
    int i, slot = -1;
    for (i = 0; i < NVM_SLOTS; i++) {
        if (s_nvm[i].used && s_nvm[i].id == id) { slot = i; break; }
        if (!s_nvm[i].used && slot < 0) slot = i;
    }
    if (slot < 0 || len > sizeof(s_nvm[0].buf))
        return -1;
    s_nvm[slot].id = id;
    s_nvm[slot].len = len;
    s_nvm[slot].used = 1;
    memcpy(s_nvm[slot].buf, buf, len);
    return 0;
}
