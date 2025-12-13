import { createSlice, PayloadAction, createAsyncThunk } from "@reduxjs/toolkit";
import { getUser, clearUser, LocalUser } from "../services/sqliteService";

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
}

// ----------------------------------
// Initial state
// ----------------------------------
const initialState: UserState = {
  isAuthenticated: false,
  loading: true,
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
      }

      state.loading = false;
    });
  },
});

// ----------------------------------
// Exports
// ----------------------------------
export const { login, logout, setUser } = userSlice.actions;
export default userSlice.reducer;