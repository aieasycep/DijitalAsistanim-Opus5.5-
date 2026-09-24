/** Stacking order of app-level layers (tab bar < scrim < sheet < immersive < toast). */
export const zIndex = {
  base: 0,
  sticky: 2,
  tabBar: 5,
  scrim: 20,
  sheet: 21,
  immersive: 30,
  toast: 40,
} as const;
