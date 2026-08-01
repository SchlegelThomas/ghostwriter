export const SETTINGS_FOCUSES = Object.freeze([
  "providers",
  "models",
  "defaults",
  "playbooks"
] as const);

export type SettingsFocus = (typeof SETTINGS_FOCUSES)[number];

export type OpenSettingsHandler = (focus?: SettingsFocus) => void;
