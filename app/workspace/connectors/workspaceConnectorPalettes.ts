const DEFAULT_WORKSPACE_BRANCH_COLORS = [
  "#3370ff",
  "#3370ff",
  "#3370ff",
  "#3370ff",
  "#3370ff",
  "#3370ff",
  "#3370ff",
  "#3370ff",
];

export const WORKSPACE_CONNECTOR_PALETTES = [
  { id: "default", name: "Default", colors: DEFAULT_WORKSPACE_BRANCH_COLORS },
  {
    id: "pastel",
    name: "Soft Pastel",
    colors: ["#fca5a5", "#fcd34d", "#86efac", "#93c5fd", "#c084fc", "#f472b6"],
  },
  {
    id: "minimal",
    name: "Minimalist",
    colors: ["#d4d4d8", "#a1a1aa", "#71717a", "#e4e4e7", "#d4d4d8", "#a1a1aa"],
  },
  {
    id: "monochrome",
    name: "Monochrome Blue",
    colors: ["#60a5fa", "#3b82f6", "#1d4ed8", "#93c5fd", "#bfdbfe", "#2563eb"],
  },
  {
    id: "vibrant",
    name: "Vibrant Neon",
    colors: ["#f43f5e", "#06b6d4", "#a855f7", "#10b981", "#f59e0b", "#3b82f6"],
  },
] as const;
