import { invoke } from '@tauri-apps/api/core';
import type { Session, TimelineMessage } from '../types/session';

export type MobileTimelineMessage = Omit<TimelineMessage, 'role'> & { role: string };
export interface RestoredConnection { connected: boolean; host?: string }

export interface MobileClient {
  restore(): Promise<RestoredConnection>;
  pair(host: string, code: string): Promise<void>;
  sessions(): Promise<Session[]>;
  timeline(provider: string, sessionId: string): Promise<MobileTimelineMessage[]>;
  disconnect(): Promise<void>;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function isSession(value: unknown): value is Session {
  return record(value)
    && ['session_id','provider','project_path','project_name','first_prompt','last_prompt','created_at','updated_at'].every(key=>typeof value[key]==='string')
    && typeof value.message_count === 'number' && typeof value.total_tokens === 'number'
    && Array.isArray(value.user_messages) && value.user_messages.every(item=>typeof item==='string');
}
function isMessage(value: unknown): value is MobileTimelineMessage {
  return record(value) && typeof value.role === 'string'
    && typeof value.content === 'string' && typeof value.timestamp === 'string';
}
// No generic URL or command transport is exposed to the mobile UI.
export const nativeClient: MobileClient = {
  restore: async () => {
    const data: unknown = await invoke('mobile_restore');
    if (!record(data) || typeof data.connected !== 'boolean'
      || (data.connected && (typeof data.host !== 'string' || !data.host.trim()))) {
      throw new Error('主机连接状态格式不兼容，请检查客户端版本');
    }
    return data.connected ? { connected: true, host: data.host as string } : { connected: false };
  },
  pair: (host, code) => invoke('mobile_pair', { host, code }),
  sessions: async () => {
    const data: unknown = await invoke('mobile_sessions');
    if (!Array.isArray(data) || !data.every(isSession)) throw new Error('主机会话数据格式不兼容，请检查电脑端版本');
    return data;
  },
  timeline: async (provider, sessionId) => {
    const data: unknown = await invoke('mobile_timeline', { provider, sessionId });
    if (!Array.isArray(data) || !data.every(isMessage)) throw new Error('主机记录数据格式不兼容，请检查电脑端版本');
    return data;
  },
  disconnect: () => invoke('mobile_disconnect'),
};
