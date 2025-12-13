import { configureStore } from '@reduxjs/toolkit';
import devices from './deviceSlice';
import readings from './readingSlice';
import user from './userSlice';

export const store = configureStore({
  reducer: { devices, readings, user },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
