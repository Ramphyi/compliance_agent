# Calora T1 Smart Thermostat — device firmware

Firmware for the **Calora T1**, a Wi-Fi smart thermostat for homes with gas or
electric boilers. The T1 is sold to consumers through retail partners and our web
shop in the **European Union and the United Kingdom** and comes pre-installed on
the device. Homeowners set it up with the Calora Home app (iOS and Android) and
control it from the app, the touch screen, or the local web page.

## What the firmware does

* Reads the on-board temperature and humidity sensor and a PIR presence sensor.
* Runs the heating control loop (hysteresis with minimum boiler cycle time, frost
  protection, away mode when nobody has been home for a while).
* **BLE provisioning:** on first boot the device advertises a provisioning service.
  The Calora Home app writes the Wi-Fi network and a cloud pairing token to it.
* **Local web configuration:** a small page on port 80 lets the owner set the
  setpoint, rename the device or reset it to factory settings from the LAN.
* **Cloud telemetry:** temperature, humidity, setpoint, boiler state and presence
  are published every 30 seconds to the Calora Cloud MQTT broker. The app and our
  energy-insights service use this data.
* **OTA updates:** every six hours the device checks the Calora firmware server
  and installs newer releases automatically into the inactive OTA slot.

## Hardware

ESP32-S3-WROOM-1 (8 MB flash, two OTA slots), SHT40 temperature and humidity
sensor, PIR sensor, boiler relay, 2.4" touch display. All hardware access goes
through `include/hal.h`. `src/hal_host.c` is a host implementation used for
development builds and unit tests; the ESP-IDF board support package lives in the
vendor repository.

## Building

```sh
make all     # host build of the application -> build/calora-t1-host
make test    # unit tests on the host
make clean
```

Release images are built with ESP-IDF v5.2 using `sdkconfig` in this directory.

## Layout

```
include/   public headers and the HAL interface
src/       application modules (control, provisioning, web config, telemetry, OTA)
test/      host unit tests
sdkconfig  ESP-IDF build configuration for release images
```

## Support

Questions from customers go to support@calora-home.eu. Firmware updates are
delivered automatically over the air.
