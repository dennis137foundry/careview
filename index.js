/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { applyGlobalFontScaleCap } from './src/utils/fontScaling';

// Cap Dynamic Type / font scaling app-wide before the first render.
applyGlobalFontScaleCap();

AppRegistry.registerComponent(appName, () => App);
