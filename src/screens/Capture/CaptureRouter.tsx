/**
 * CaptureRouter.tsx
 *
 * Single detection point for which capture flow a device gets.
 *
 * iHealth devices (BP3L, BP5, BP5S, BG5S, HS2, HS2S, HS4S) keep using
 * CaptureScreen exactly as before — that file is not modified by generic-BLE
 * work and cannot be reached by it. Generic BLE devices (A&D UA-651BLE and
 * other standard Bluetooth Blood Pressure Profile monitors) go to
 * BleCaptureScreen instead.
 *
 * The two screens are separate components, so they have separate hooks, effects
 * and native event listeners. A bug in the BLE flow cannot leak into the iHealth
 * flow, which is the one already in production.
 *
 * Routing on `source` rather than on the model string is deliberate: `source` is
 * set by the native layer at discovery, persisted in SQLite, and is the same
 * field the rest of the app already uses to tell the two families apart.
 */

import React, { useMemo } from "react";
import { useSelector } from "react-redux";

import CaptureScreen from "./CaptureScreen";
import BleCaptureScreen from "./BleCaptureScreen";
import type { RootState } from "../../redux/store";

export default function CaptureRouter(props: any) {
  const { deviceId } = props.route?.params ?? {};
  const devices = useSelector((state: RootState) => state.devices.devices);

  const isGenericBle = useMemo(() => {
    const device = devices.find((d) => d.id === deviceId);
    return device?.source === "BLE_GATT";
  }, [devices, deviceId]);

  // Unknown device (not yet loaded, or a bad id) falls through to CaptureScreen,
  // which already renders its own "device not found" state. Defaulting to the
  // iHealth path also means a lookup failure can never strand an iHealth device
  // in the BLE flow.
  return isGenericBle ? <BleCaptureScreen {...props} /> : <CaptureScreen {...props} />;
}
