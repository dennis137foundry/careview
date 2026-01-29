import { createSlice, PayloadAction, createAsyncThunk } from "@reduxjs/toolkit";
import { getUser, clearUser, LocalUser } from "../services/sqliteService";

// ----------------------------------
// State type definition
// ----------------------------------
interface BPThresholds {
  systolicHigh: number;
  diastolicHigh: number;
}

interface UserState {
  isAuthenticated: boolean;
  loading: boolean;

  patientId?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;

  providerFirstName?: string;
  providerLastName?: string;
  providerPracticeName?: string;

  // BP Thresholds from physician
  bpThresholds: BPThresholds;
}

// ----------------------------------
// Initial state
// ----------------------------------
const initialState: UserState = {
  isAuthenticated: false,
  loading: true,
  bpThresholds: {
    systolicHigh: 140,  // Default values per clinical guidelines
    diastolicHigh: 90,
  },
};

// ----------------------------------
// Thunk: load user from SQLite at startup
// ----------------------------------
export const loadUser = createAsyncThunk("user/loadUser", async () => {
  try {
    const user = await getUser();
    return user; // LocalUser | null
  } catch (e) {
    console.error("❌ Failed to load user:", e);
    return null;
  }
});

// ----------------------------------
// Slice
// ----------------------------------
const userSlice = createSlice({
  name: "user",
  initialState,
  reducers: {
    // --- Login sets Redux state (SQLite is handled in authService) ---
    login: (state, action: PayloadAction<LocalUser>) => {
      const u = action.payload;

      state.isAuthenticated = true;
      state.patientId = u.patientId;
      state.firstName = u.firstName;
      state.lastName = u.lastName;
      state.phone = u.phone;
      state.providerFirstName = u.providerFirstName;
      state.providerLastName = u.providerLastName;
      state.providerPracticeName = u.providerPracticeName;
      state.loading = false;

      // Set BP thresholds from login response
      state.bpThresholds = {
        systolicHigh: u.systolicHigh ?? 140,
        diastolicHigh: u.diastolicHigh ?? 90,
      };
    },

    // --- Manual override if needed ---
    setUser: (state, action: PayloadAction<LocalUser>) => {
      const u = action.payload;

      state.isAuthenticated = true;
      state.patientId = u.patientId;
      state.firstName = u.firstName;
      state.lastName = u.lastName;
      state.phone = u.phone;
      state.providerFirstName = u.providerFirstName;
      state.providerLastName = u.providerLastName;
      state.providerPracticeName = u.providerPracticeName;
      state.loading = false;

      // Set BP thresholds
      state.bpThresholds = {
        systolicHigh: u.systolicHigh ?? 140,
        diastolicHigh: u.diastolicHigh ?? 90,
      };
    },

    // --- Update BP thresholds separately (e.g., from a refresh) ---
    setBPThresholds: (state, action: PayloadAction<BPThresholds>) => {
      state.bpThresholds = action.payload;
    },

    // --- Logout clears state + SQLite ---
    logout: (state) => {
      try {
        clearUser();
        console.log("✅ User cleared from SQLite");
      } catch (e) {
        console.warn("⚠️ Failed to clear user:", e);
      }

      state.isAuthenticated = false;
      state.patientId = undefined;
      state.firstName = undefined;
      state.lastName = undefined;
      state.phone = undefined;
      state.providerFirstName = undefined;
      state.providerLastName = undefined;
      state.providerPracticeName = undefined;
      state.loading = false;
      state.bpThresholds = {
        systolicHigh: 140,
        diastolicHigh: 90,
      };
    },
  },

  // --- Restore user after SQLite load ---
  extraReducers: (builder) => {
    builder.addCase(loadUser.fulfilled, (state, action) => {
      const u = action.payload;

      if (u) {
        state.isAuthenticated = true;
        state.patientId = u.patientId;
        state.firstName = u.firstName;
        state.lastName = u.lastName;
        state.phone = u.phone;
        state.providerFirstName = u.providerFirstName;
        state.providerLastName = u.providerLastName;
        state.providerPracticeName = u.providerPracticeName;

        // Restore BP thresholds from SQLite
        state.bpThresholds = {
          systolicHigh: u.systolicHigh ?? 140,
          diastolicHigh: u.diastolicHigh ?? 90,
        };
      }

      state.loading = false;
    });
  },
});

// ----------------------------------
// Selectors
// ----------------------------------

/**
 * Check if a BP reading is considered HIGH based on physician thresholds
 * Returns true if systolic >= threshold OR diastolic >= threshold
 */
export const isBPHigh = (
  systolic: number,
  diastolic: number,
  thresholds: BPThresholds
): boolean => {
  return systolic >= thresholds.systolicHigh || diastolic >= thresholds.diastolicHigh;
};

/**
 * Get color for BP reading based on threshold
 */
export const getBPColor = (
  systolic: number,
  diastolic: number,
  thresholds: BPThresholds
): 'normal' | 'high' => {
  return isBPHigh(systolic, diastolic, thresholds) ? 'high' : 'normal';
};

// ----------------------------------
// Exports
// ----------------------------------
export const { login, logout, setUser, setBPThresholds } = userSlice.actions;
export default userSlice.reducer;
