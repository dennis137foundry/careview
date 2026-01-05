import { createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit';
import { nanoid } from 'nanoid/non-secure';
import { getAllReadings, saveReading, SavedReading } from '../services/sqliteService';

export const loadReadings = createAsyncThunk('readings/load', async () => {
  return await getAllReadings();
});

export const addReadingAndPersist = createAsyncThunk(
  'readings/addAndPersist',
  async (payload: Omit<SavedReading, 'id'|'ts'>, { rejectWithValue }) => {
    try {
      const r: SavedReading = { 
        id: nanoid(), 
        ts: Date.now(), 
        ...payload,
        // Ensure measurementCondition is included if provided
        measurementCondition: payload.measurementCondition,
      };
      saveReading(r);
      return r;
    } catch (e:any) {
      return rejectWithValue(e?.message ?? 'saveReading failed');
    }
  }
);

type State = { items: SavedReading[]; loading: boolean; error?: string | null };
const initialState: State = { items: [], loading: false, error: null };

const readings = createSlice({
  name: 'readings',
  initialState,
  reducers: {
    clear(state) { state.items = []; }
  },
  extraReducers: (b) => {
    b.addCase(loadReadings.pending, (s)=>{ s.loading = true; s.error = null; });
    b.addCase(loadReadings.fulfilled, (s,a:PayloadAction<SavedReading[]>)=>{ s.loading=false; s.items=a.payload; });
    b.addCase(loadReadings.rejected, (s,a)=>{ s.loading=false; s.error=String(a.error.message); });

    b.addCase(addReadingAndPersist.fulfilled, (s,a:PayloadAction<SavedReading>) => {
      s.items.unshift(a.payload);
    });
  }
});

export const { clear } = readings.actions;
export default readings.reducer;