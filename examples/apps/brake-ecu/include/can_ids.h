/* CAN identifiers and signal layout for the HBX-220. */
#ifndef HBX_CAN_IDS_H
#define HBX_CAN_IDS_H

/* Rx: chassis bus */
#define CAN_ID_WHEEL_SPEED   0x0A0  /* 4x wheel speed, 2 bytes each (1/128 km/h) */
#define CAN_ID_BRAKE_PEDAL   0x0A1  /* pedal force + driver brake request */
#define CAN_ID_VEHICLE_STATE 0x0A2  /* vehicle speed, gear, stability flags */

/* Tx: brake status */
#define CAN_ID_BRAKE_STATUS  0x120
#define CAN_ID_WHEEL_PRESSURE 0x121

/* UDS (ISO 15765 / 14229) */
#define CAN_ID_UDS_REQUEST  0x7E0
#define CAN_ID_UDS_RESPONSE 0x7E8

/* Physical limits used for plausibility */
#define WHEEL_SPEED_MAX_RAW 0x7FFF
#define VEHICLE_SPEED_MAX_KMH 320

#endif /* HBX_CAN_IDS_H */
