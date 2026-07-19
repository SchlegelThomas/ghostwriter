export const ghostwriterTheme = Object.freeze({
  colors: Object.freeze({
    ink: "#28231f",
    muted: "#766c63",
    paper: "#fcfaf6",
    canvas: "#f5f1ea",
    panel: "#ffffff",
    topbar: "#fdfcf9",
    wash: "#f2eee7",
    line: "#ddd5ca",
    documentLine: "#d8d0c5",
    accent: "#754535",
    accentSoft: "#f2e5df",
    kicker: "#6e3f32",
    brandDark: "#2c2a27",
    rail: "#322c27",
    railActive: "#4a4039",
    railText: "#cbbfb4",
    brandRule: "#b3a99d",
    brandRuleSoft: "#cbc2b6",
    green: "#3f684f",
    greenSoft: "#e7f0e9",
    blue: "#3f6175",
    blueSoft: "#e8f0f4",
    amber: "#80622c",
    amberSoft: "#f5ecd9",
    red: "#89514b",
    redSoft: "#f5e5e2"
  }),
  fonts: Object.freeze({
    brand: "GhostwriterBrand",
    story: "GhostwriterStory",
    storyItalic: "GhostwriterStoryItalic",
    ui: "GhostwriterUI",
    uiMedium: "GhostwriterUIMedium",
    uiSemibold: "GhostwriterUISemibold"
  }),
  shell: Object.freeze({
    topbarHeight: 52,
    railWidth: 36,
    navigatorWidth: 252,
    structureCollapsedWidth: 36,
    inspectorWidth: 276
  })
});

export type GhostwriterTheme = typeof ghostwriterTheme;
