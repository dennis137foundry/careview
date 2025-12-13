import { createSlice, PayloadAction, createAsyncThunk } from "@reduxjs/toolkit";
import { 
  getDevices, 
  saveDevice as saveDeviceToDB, 
  removeDevice as removeDeviceFromDB,
  updateDeviceBottleCode as updateBottleCodeInDB,
  DeviceRecord 
} from "../services/sqliteService";

interface DeviceState {
  devices: DeviceRecord[];
  loading: boolean;
}

const initialState: DeviceState = {
  devices: [],
  loading: true,
};

export const loadDevices = createAsyncThunk("devices/load", async () => {
  return getDevices();
});

const deviceSlice = createSlice({
  name: "devices",
  initialState,
  reducers: {
    addDevice: (state, action: PayloadAction<DeviceRecord>) => {
      saveDeviceToDB(action.payload);
      // Avoid duplicates
      const exists = state.devices.find(d => d.id === action.payload.id);
      if (!exists) {
        state.devices.push(action.payload);
      } else {
        // Update existing device
        const index = state.devices.findIndex(d => d.id === action.payload.id);
        if (index !== -1) {
          state.devices[index] = action.payload;
        }
      }
    },
    removeDevice: (state, action: PayloadAction<string>) => {
      removeDeviceFromDB(action.payload);
      state.devices = state.devices.filter((d) => d.id !== action.payload);
    },
    updateBottleCode: (state, action: PayloadAction<{ deviceId: string; bottleCode: string }>) => {
      const { deviceId, bottleCode } = action.payload;
      updateBottleCodeInDB(deviceId, bottleCode);
      const device = state.devices.find(d => d.id === deviceId);
      if (device) {
        device.bottleCode = bottleCode;
      }
    },
  },
  extraReducers: (builder) => {
    builder.addCase(loadDevices.fulfilled, (state, action) => {
      state.devices = action.payload;
      state.loading = false;
    });
  },
});

export const { addDevice, removeDevice, updateBottleCode } = deviceSlice.actions;
export default deviceSlice.reducer;
