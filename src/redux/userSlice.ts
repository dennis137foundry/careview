import { createSlice, PayloadAction, createAsyncThunk } from "@reduxjs/toolkit";
import {
  getUser,
  clearUser,
  updateUserEdd,
  updateUserThresholds,
  LocalUser,
  EddSource,
} from "../services/sqliteService";
import {
  EMR_DEFAULT_THRESHOLDS,
  thresholdsFromStored,
  type VitalThresholds,
} from "../utils/thresholdLogic";

// ----------------------------------
// State type definition
// ----------------------------------

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

  // Estimated due date "YYYY-MM-DD" — aligns the dashboard daily facts to
  // the pregnancy. 'emr' source wins over 'patient'.
  edd?: string | null;
  eddSource?: EddSource | null;

  // The high-reading thresholds the EMR resolved for this patient (her own →
  // her provider's → system default, per number). Written at login and by
  // every profile refresh; mirrored to SQLite. Never edited on the phone.
  thresholds: VitalThresholds;
}

// ----------------------------------
// Initial state
// ----------------------------------
const initialState: UserState = {
  isAuthenticated: false,
  loading: true,
  // Placeholder until loadUser() restores the stored values; nothing is
  // judged before a user exists.
  thresholds: EMR_DEFAULT_THRESHOLDS,
};

// ----------------------------------
// Thunk: load user from SQLite at startup
// ----------------------------------
export const loadUser = createAsyncThunk("user/loadUser", async () => {
  try {
    const user = await getUser();
    return user; // LocalUser | null
  } catch (e) {
    console.error("[User] Failed to load user:", e);
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
      state.edd = u.edd ?? null;
      state.eddSource = u.eddSource ?? null;
      state.loading = false;

      // Thresholds from the login response (already saved to SQLite by authService)
      state.thresholds = thresholdsFromStored(u);
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
      state.edd = u.edd ?? null;
      state.eddSource = u.eddSource ?? null;
      state.loading = false;

      state.thresholds = thresholdsFromStored(u);
    },

    // --- Thresholds from a profile refresh (persists to SQLite too).
    // Until 2.4 this updated Redux only, so a value refreshed in the
    // foreground was lost on the next cold start.
    // No-op when nothing changed: the profile is fetched on every launch,
    // foreground and capture-screen open, and a fresh object with the same
    // three numbers would re-render every threshold consumer and re-create
    // the capture screens' callbacks (which re-registers their native
    // listeners) for no reason — and write SQLite each time.
    setThresholds: (state, action: PayloadAction<VitalThresholds>) => {
      const t = action.payload;
      const cur = state.thresholds;
      if (
        cur.systolicHigh === t.systolicHigh &&
        cur.diastolicHigh === t.diastolicHigh &&
        cur.glucoseHigh === t.glucoseHigh
      ) {
        return;
      }
      state.thresholds = t;
      try {
        updateUserThresholds(t);
      } catch (e) {
        console.error("[User] Failed to persist thresholds:", e);
      }
    },

    // --- Set/replace the due date (persists to SQLite too).
    // 'emr' (login or daily profile refresh) always overwrites; 'patient'
    // (typed into the dashboard card) never overwrites an 'emr' value.
    setEdd: (
      state,
      action: PayloadAction<{ edd: string; source: EddSource }>
    ) => {
      const { edd, source } = action.payload;
      if (source === "patient" && state.eddSource === "emr") {
        return; // EMR wins — ignore a patient value over a clinician one
      }
      try {
        updateUserEdd(edd, source);
      } catch (e) {
        console.error("[User] Failed to persist EDD:", e);
        return; // Don't let Redux and SQLite disagree
      }
      state.edd = edd;
      state.eddSource = source;
    },

    // --- Logout clears state + SQLite ---
    logout: (state) => {
      try {
        clearUser();
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
      state.edd = null;
      state.eddSource = null;
      state.loading = false;
      state.thresholds = EMR_DEFAULT_THRESHOLDS;
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
        state.edd = u.edd ?? null;
        state.eddSource = u.eddSource ?? null;

        // Restore the last thresholds the EMR sent (a 2.3 row has no
        // glucoseHigh yet; the launch-time refresh fills it in).
        state.thresholds = thresholdsFromStored(u);
      }

      state.loading = false;
    });
  },
});

// ----------------------------------
// Selectors
// ----------------------------------

// The High predicates (isBPHigh, isGlucoseHigh) live in utils/thresholdLogic.ts.

// ----------------------------------
// Exports
// ----------------------------------
export const { login, logout, setUser, setThresholds, setEdd } = userSlice.actions;
export default userSlice.reducer;
