import { getCurrentWindow } from "@tauri-apps/api/window";
export const thisWindowLabel = () => getCurrentWindow().label;
export const hideThisWindow = () => getCurrentWindow().hide();
export const showThisWindow = () => getCurrentWindow().show();
