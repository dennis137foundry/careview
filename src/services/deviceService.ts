// Toggle between fake and real implementations
// Set USE_REAL_DEVICES to true when testing with actual iHealth hardware

const USE_REAL_DEVICES = true;

import fake from './fakeDeviceService';
import real from './realDeviceService';

export default USE_REAL_DEVICES ? real : fake;
