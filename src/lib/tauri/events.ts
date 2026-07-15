import { listen, type UnlistenFn } from "@tauri-apps/api/event";
export function on<T>(event: string, cb: (payload: T) => void): Promise<UnlistenFn> {
  return listen<T>(event, (e) => cb(e.payload));
}
