// src/constants/buttons.ts
// Single source of truth for button styling. Every button in the app maps
// to one of these roles — do not introduce new button colors or radii.
//
//   Primary     — the main action anywhere (solid deep teal, white text)
//   Quiet       — Cancel / Skip / Answer Later (light gray, muted text)
//   Destructive — delete / wipe / stop (solid red, white text)
//   Links       — inline text links use LINK_COLOR with no background
//
// Radius is 6 everywhere, except the edge-to-edge New Reading dock (0)
// and truly circular icon buttons.

export const BTN = {
  primary: "#056E78",
  primaryText: "#ffffff",

  quiet: "#eef2f6",
  quietText: "#5b6b7f",

  destructive: "#c62828",
  destructiveText: "#ffffff",

  link: "#00509f",

  radius: 6,
} as const;

// Size presets (apply as paddingVertical / fontSize / fontWeight):
//   Large  — full-width CTAs:            paddingVertical 14, fontSize 16, weight 700
//   Medium — inline/header buttons:      paddingVertical 10, paddingHorizontal 16, fontSize 14, weight 600
//   Small  — chips, in-card actions:     paddingVertical 8, paddingHorizontal 12, fontSize 13, weight 600
export const BTN_SIZE = {
  large: { paddingVertical: 14, fontSize: 16, fontWeight: "700" as const },
  medium: { paddingVertical: 10, paddingHorizontal: 16, fontSize: 14, fontWeight: "600" as const },
  small: { paddingVertical: 8, paddingHorizontal: 12, fontSize: 13, fontWeight: "600" as const },
} as const;
