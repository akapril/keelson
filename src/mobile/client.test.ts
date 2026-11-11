import { describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { nativeClient } from './client';
vi.mock('@tauri-apps/api/core',()=>({invoke:vi.fn()}));
describe('native response validation',()=>{
  it('rejects valid JSON with an invalid session shape',async()=>{
    vi.mocked(invoke).mockResolvedValueOnce({error:'not a list'});
    await expect(nativeClient.sessions()).rejects.toThrow('会话数据格式');
    vi.mocked(invoke).mockResolvedValueOnce([{session_id:'x'}]);
    await expect(nativeClient.sessions()).rejects.toThrow('会话数据格式');
  });
  it('rejects malformed messages before rendering',async()=>{
    vi.mocked(invoke).mockResolvedValueOnce([{role:'assistant',content:{bad:true},timestamp:''}]);
    await expect(nativeClient.timeline('claude','s')).rejects.toThrow('记录数据格式');
  });
  it('passes empty arrays and text messages',async()=>{
    vi.mocked(invoke).mockResolvedValueOnce([]);
    expect(await nativeClient.sessions()).toEqual([]);
    const data=[{role:'assistant',content:'done',timestamp:''}];
    vi.mocked(invoke).mockResolvedValueOnce(data);
    expect(await nativeClient.timeline('claude','s')).toEqual(data);
  });
});
