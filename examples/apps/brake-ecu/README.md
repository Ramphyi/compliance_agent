# HBX-220 brake controller — application software

Application software for the **HBX-220**, an electronic brake-control ECU built by
Hensel Braking Systems, a Tier-1 automotive supplier. The HBX-220 combines ABS
(anti-lock braking) with a brake-by-wire actuator stage and is supplied to vehicle
OEMs for passenger cars type-approved for the **European Union and UNECE** markets.

The software is developed to **ASIL B** (ISO 26262). This repository holds the
application layer; the AUTOSAR basic software, the MCAL and the safety OS are
delivered separately by the platform team.

## What it does

* Receives wheel-speed, brake-pedal and vehicle-state signals over **CAN**.
* Runs the ABS slip-control cycle and computes per-wheel brake pressure demands.
* Commands the hydraulic actuator and reports status back on CAN.
* Exposes **UDS** diagnostics over CAN (ISO 14229): read DTCs, read data by
  identifier, SecurityAccess, and a RequestDownload / TransferData path used by
  the workshop flashing tool to update the application.

## Building and testing

The application is written in C99 and is built host-side for off-target unit
testing. CAN, timers and the actuator are reached through `include/platform.h`;
`src/platform_host.c` is the host stub used by the tests.

```sh
make all     # host build of the test harness objects
make test    # run the off-target unit tests
make clean
```

On target the code is cross-compiled with the OEM's AUTOSAR toolchain; that build
is driven from the integration project, not this repository.

## Layout

```
include/    headers: CAN frames, signals, UDS, platform interface
src/        application modules (CAN rx/tx, ABS, UDS server, flashing, actuator)
test/       off-target unit tests with a small assert runner
```

## Interfaces

* CAN IDs and signal layout: `include/can_ids.h`
* UDS services: `include/uds.h`
* Diagnostic trouble codes: see `src/uds_server.c`

Contact: brake-sw@hensel-braking.example for integration questions.
