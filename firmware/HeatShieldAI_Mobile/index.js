// Must be the very first import: Firebase Auth needs crypto.getRandomValues()
// for parts of the sign-in flow, which Expo Go polyfills for you invisibly
// but a standalone build does not unless this runs before anything else
// (including firebase) touches the auth SDK.
import 'react-native-get-random-values';

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
