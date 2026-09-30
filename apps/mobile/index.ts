// Expo Router entry: registers the root component and the file-based routes under `app/`.
// The Intl repair (KPL-27) runs first, so no route module formats before plural rules and zone
// offsets are in place.
import './src/lib/intl-setup';
import 'expo-router/entry';
