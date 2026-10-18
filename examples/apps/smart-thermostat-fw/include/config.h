#ifndef CALORA_CONFIG_H
#define CALORA_CONFIG_H

#define FW_VERSION "2.4.1"
#define DEVICE_MODEL "T1"

/* Control */
#define CONTROL_PERIOD_MS 1000u
#define DEFAULT_SETPOINT_CENTI 2050
#define DEFAULT_AWAY_SETPOINT_CENTI 1600
#define FROST_PROTECT_CENTI 500
#define HYSTERESIS_CENTI 30
#define MIN_BOILER_CYCLE_MS (3u * 60u * 1000u)
#define AWAY_AFTER_MS (45u * 60u * 1000u)

/* Calora Cloud */
#define TELEMETRY_BROKER_URI "mqtt://telemetry.calora-cloud.eu:1883"
#define TELEMETRY_PERIOD_MS 30000u

/* Firmware updates */
#define OTA_BASE_URL "http://fw.calora-cloud.eu/t1/stable"
#define OTA_CHECK_PERIOD_MS (6u * 3600u * 1000u)

/* Local web configuration */
#define LOCAL_ADMIN_USER "admin"
#define DEFAULT_ADMIN_PASSWORD "calora2024"

#endif /* CALORA_CONFIG_H */
