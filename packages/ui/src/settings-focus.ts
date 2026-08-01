export type SettingsFocus = "providers" | "models" | "defaults";

export type OpenSettingsHandler = (focus?: SettingsFocus) => void;
