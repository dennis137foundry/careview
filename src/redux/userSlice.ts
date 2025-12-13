import { createSlice, PayloadAction, createAsyncThunk } from "@reduxjs/toolkit";
import { getUser, saveUser, clearUser } from "../services/sqliteService";

// ----------------------------------
// State type definition
// ----------------------------------
interface UserState {
  isAuthenticated: boolean;
  patientId?: string;
  name?: string;
  phone?: string;
  loading: boolean;
}

// ----------------------------------
// Initial state
// ----------------------------------
const initialState: UserState = {
  isAuthenticated: false,
  loading: true, // true until loadUser() runs at startup
};

// ----------------------------------
// Thunk: load user from SQLite at app launch
// ----------------------------------
export const loadUser = createAsyncThunk("user/loadUser", async () => {
  try {
    const user = await getUser();
    return user;
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
    // --- Login (called from AuthScreen) ---
    login: (
      state,
      action: PayloadAction<{ patientId: string; name: string; phone: string }>
    ) => {
      const { patientId, name, phone } = action.payload;
      try {
        saveUser(patientId, name, phone); // persist to SQLite
        console.log("✅ User saved locally:", name);
      } catch (e) {
        console.error("❌ Failed to save user:", e);
      }

      state.isAuthenticated = true;
      state.patientId = patientId;
      state.name = name;
      state.phone = phone;
      state.loading = false;
    },

    // --- SetUser (manual override if needed) ---
    setUser: (
      state,
      action: PayloadAction<{ patientId: string; name: string; phone: string }>
    ) => {
      state.isAuthenticated = true;
      state.patientId = action.payload.patientId;
      state.name = action.payload.name;
      state.phone = action.payload.phone;
      state.loading = false;
    },

    // --- Logout clears both SQLite + Redux state ---
    logout: (state) => {
      try {
        clearUser();
        console.log("✅ User cleared from SQLite");
      } catch (e) {
        console.warn("⚠️ Failed to clear user:", e);
      }

      state.isAuthenticated = false;
      state.patientId = undefined;
      state.name = undefined;
      state.phone = undefined;
      state.loading = false;
    },
  },

  // --- Load persisted user at startup ---
  extraReducers: (builder) => {
    builder.addCase(loadUser.fulfilled, (state, action) => {
      if (action.payload) {
        state.isAuthenticated = true;
        state.patientId = action.payload.patientId;
        state.name = action.payload.name;
        state.phone = action.payload.phone;
        console.log("✅ Restored user session from SQLite");
      } else {
        console.log("ℹ️ No user found in SQLite");
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
