import type { CustomThemeColors, ThemeId, UiSettings } from "../shared/types";

export interface ThemePalette {
  bg: string;
  side: string;
  canvas: string;
  panel: string;
  panel2: string;
  edge: string;
  accent: string;
  accent2: string;
  ink: string;
  muted: string;
}

export interface ThemePreset {
  id: ThemeId;
  label: string;
  dark: boolean;
  vars: ThemePalette;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "warm-dark",
    label: "Warm Dark",
    dark: true,
    vars: { bg: "#1e1e1e", side: "#181818", canvas: "#232323", panel: "#252526", panel2: "#2f2f31", edge: "#3a3a3a", accent: "#d97757", accent2: "#c2603f", ink: "#e0e0e0", muted: "#888888" }
  },
  {
    id: "oled",
    label: "OLED Black",
    dark: true,
    vars: { bg: "#000000", side: "#000000", canvas: "#0a0a0a", panel: "#0e0e0e", panel2: "#1c1c1c", edge: "#242424", accent: "#d97757", accent2: "#b95a38", ink: "#e8e4de", muted: "#7c776f" }
  },
  {
    id: "dracula",
    label: "Dracula",
    dark: true,
    vars: { bg: "#282a36", side: "#21222c", canvas: "#2d2f3b", panel: "#343746", panel2: "#44475a", edge: "#44475a", accent: "#bd93f9", accent2: "#ff79c6", ink: "#f8f8f2", muted: "#8b95b0" }
  },
  {
    id: "nord",
    label: "Nord",
    dark: true,
    vars: { bg: "#2e3440", side: "#272c36", canvas: "#333a47", panel: "#3b4252", panel2: "#434c5e", edge: "#4c566a", accent: "#88c0d0", accent2: "#5e9fac", ink: "#eceff4", muted: "#94a0b3" }
  },
  {
    id: "solarized",
    label: "Solarized Dark",
    dark: true,
    vars: { bg: "#002b36", side: "#00212b", canvas: "#073642", panel: "#0b3d4c", panel2: "#1c4a58", edge: "#1e4a57", accent: "#cb4b16", accent2: "#a13b10", ink: "#e8e2d7", muted: "#7f9398" }
  },
  {
    id: "light",
    label: "Light",
    dark: false,
    vars: { bg: "#f2efe9", side: "#e9e5dd", canvas: "#faf8f4", panel: "#ffffff", panel2: "#e6e1d8", edge: "#d6d0c5", accent: "#c2603f", accent2: "#a14c2f", ink: "#26221e", muted: "#6f6961" }
  }
];

export function normalizeTheme(theme: string | undefined): ThemeId {
  if (!theme) return "warm-dark";
  if (theme === "dark" || theme === "system") return "warm-dark";
  return THEME_PRESETS.some((p) => p.id === theme) || theme === "custom" ? (theme as ThemeId) : "warm-dark";
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [128, 128, 128];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(rgb: [number, number, number]): string {
  return "#" + rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")).join("");
}

function mix(a: string, b: string, amount: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return toHex([A[0] + (B[0] - A[0]) * amount, A[1] + (B[1] - A[1]) * amount, A[2] + (B[2] - A[2]) * amount]);
}

function scale(hex: string, factor: number): string {
  const [r, g, b] = hexToRgb(hex);
  return toHex([r * factor, g * factor, b * factor]);
}

export function isLightColor(hex: string): boolean {
  const [r, g, b] = hexToRgb(hex);
  return (r * 299 + g * 587 + b * 114) / 1000 > 140;
}

export function customPalette(c: CustomThemeColors): ThemePalette {
  const light = isLightColor(c.bg);
  return {
    bg: c.bg,
    side: mix(c.bg, c.panel, 0.65),
    canvas: mix(c.bg, light ? "#000000" : "#ffffff", 0.03),
    panel: c.panel,
    panel2: mix(c.panel, light ? "#000000" : "#ffffff", 0.12),
    edge: mix(c.panel, c.text, light ? 0.22 : 0.28),
    accent: c.accent,
    accent2: scale(c.accent, 0.82),
    ink: c.text,
    muted: mix(c.text, c.bg, 0.45)
  };
}

export function currentPresetMeta(theme: ThemeId): { label: string; dark: boolean } {
  const preset = THEME_PRESETS.find((p) => p.id === theme);
  if (preset) return { label: preset.label, dark: preset.dark };
  return { label: "Custom", dark: true };
}

export function applyUiTheme(ui: UiSettings | undefined | null): void {
  const id = normalizeTheme(ui?.theme);
  const preset = THEME_PRESETS.find((p) => p.id === id);
  const vars: ThemePalette =
    id === "custom"
      ? customPalette(ui?.custom ?? { bg: "#141414", panel: "#1e1e1e", text: "#ece7e1", accent: "#d97757" })
      : preset?.vars ?? THEME_PRESETS[0].vars;
  const dark = id === "custom" ? !isLightColor(vars.bg) : preset?.dark ?? true;
  const root = document.documentElement;
  const entries: [keyof ThemePalette, string][] = Object.entries(vars) as [keyof ThemePalette, string][];
  for (const [key, hex] of entries) {
    const [r, g, b] = hexToRgb(hex);
    root.style.setProperty(`--c-${key.replace(/([A-Z])/g, "")}`, `${r} ${g} ${b}`);
  }
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

export function themeIsDark(ui: UiSettings | undefined | null): boolean {
  const id = normalizeTheme(ui?.theme);
  if (id === "custom") return !isLightColor(ui?.custom?.bg ?? "#141414");
  return THEME_PRESETS.find((p) => p.id === id)?.dark ?? true;
}
