#include "calora.h"
#include "config.h"
#include "test.h"

static void test_init_defaults(void)
{
    thermostat_t t;
    thermostat_init(&t);
    CHECK(t.setpoint_centi == DEFAULT_SETPOINT_CENTI);
    CHECK(t.mode == MODE_AUTO);
    CHECK(t.heating == 0);
}

static void test_setpoint_limits(void)
{
    thermostat_t t;
    thermostat_init(&t);
    CHECK(thermostat_set_setpoint(&t, 2200) == 0);
    CHECK(t.setpoint_centi == 2200);
    CHECK(thermostat_set_setpoint(&t, 3500) != 0);
    CHECK(thermostat_set_setpoint(&t, 100) != 0);
    CHECK(t.setpoint_centi == 2200);
}

static void test_hysteresis(void)
{
    thermostat_t t;
    uint32_t now = 1000;
    thermostat_init(&t);

    CHECK(thermostat_step(&t, 2040, 1, now) == 0);  /* inside band */
    CHECK(thermostat_step(&t, 2000, 1, now) == 1);  /* below band */
    now += MIN_BOILER_CYCLE_MS;
    CHECK(thermostat_step(&t, 2060, 1, now) == 1);  /* still heating */
    CHECK(thermostat_step(&t, 2090, 1, now) == 0);  /* above band */
}

static void test_min_cycle_time(void)
{
    thermostat_t t;
    thermostat_init(&t);
    CHECK(thermostat_step(&t, 1900, 1, 1000) == 1);
    CHECK(thermostat_step(&t, 2200, 1, 2000) == 1);  /* too soon to switch off */
    CHECK(thermostat_step(&t, 2200, 1, 1000 + MIN_BOILER_CYCLE_MS) == 0);
}

static void test_away_mode(void)
{
    thermostat_t t;
    thermostat_init(&t);
    thermostat_step(&t, 2100, 1, 1000);
    CHECK(thermostat_target(&t) == DEFAULT_SETPOINT_CENTI);
    thermostat_step(&t, 2100, 0, 1000 + AWAY_AFTER_MS);
    CHECK(t.away == 1);
    CHECK(thermostat_target(&t) == DEFAULT_AWAY_SETPOINT_CENTI);
}

static void test_frost_protection(void)
{
    thermostat_t t;
    thermostat_init(&t);
    t.mode = MODE_OFF;
    CHECK(thermostat_step(&t, 1200, 0, 1000) == 0);
    CHECK(thermostat_step(&t, 450, 0, 2000) == 1);
}

void suite_control(void)
{
    RUN(test_init_defaults);
    RUN(test_setpoint_limits);
    RUN(test_hysteresis);
    RUN(test_min_cycle_time);
    RUN(test_away_mode);
    RUN(test_frost_protection);
}
