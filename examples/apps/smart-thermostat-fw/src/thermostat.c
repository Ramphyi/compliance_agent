/* Heating control: hysteresis around the active setpoint, minimum boiler
 * cycle time, frost protection and presence-based away mode. */
#include "calora.h"
#include "config.h"

#define SETPOINT_MIN_CENTI 500
#define SETPOINT_MAX_CENTI 3000

void thermostat_init(thermostat_t *t)
{
    t->setpoint_centi = DEFAULT_SETPOINT_CENTI;
    t->away_setpoint_centi = DEFAULT_AWAY_SETPOINT_CENTI;
    t->mode = MODE_AUTO;
    t->heating = 0;
    t->away = 0;
    t->last_switch_ms = 0;
    t->last_presence_ms = 0;
}

int thermostat_set_setpoint(thermostat_t *t, int16_t centi)
{
    if (centi < SETPOINT_MIN_CENTI || centi > SETPOINT_MAX_CENTI)
        return -1;
    t->setpoint_centi = centi;
    return 0;
}

int16_t thermostat_target(const thermostat_t *t)
{
    switch (t->mode) {
    case MODE_OFF:
        return FROST_PROTECT_CENTI;
    case MODE_HEAT:
        return t->setpoint_centi;
    case MODE_AUTO:
    default:
        return t->away ? t->away_setpoint_centi : t->setpoint_centi;
    }
}

static int may_switch(const thermostat_t *t, uint32_t now_ms)
{
    if (t->last_switch_ms == 0)
        return 1;
    return (uint32_t)(now_ms - t->last_switch_ms) >= MIN_BOILER_CYCLE_MS;
}

int thermostat_step(thermostat_t *t, int16_t temp_centi, int presence, uint32_t now_ms)
{
    int16_t target;
    int want;

    if (presence)
        t->last_presence_ms = now_ms;
    t->away = (uint32_t)(now_ms - t->last_presence_ms) >= AWAY_AFTER_MS;

    target = thermostat_target(t);
    if (temp_centi < FROST_PROTECT_CENTI) {
        want = 1;
    } else if (t->heating) {
        want = temp_centi < target + HYSTERESIS_CENTI;
    } else {
        want = temp_centi < target - HYSTERESIS_CENTI;
    }

    if (want != t->heating && (may_switch(t, now_ms) || temp_centi < FROST_PROTECT_CENTI)) {
        t->heating = want;
        t->last_switch_ms = now_ms;
    }
    return t->heating;
}
