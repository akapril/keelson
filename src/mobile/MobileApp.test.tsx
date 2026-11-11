// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MobileApp } from './MobileApp';
import type { MobileClient } from './client';
import type { Session } from '../types/session';

afterEach(cleanup);
const session: Session = { session_id: 's1', provider: 'claude', project_path: '/project', project_name: 'Keelson', first_prompt: '修复配对', last_prompt: '', created_at: '', updated_at: '', message_count: 2, user_messages: [], total_tokens: 12 };
function client(): MobileClient { return { restore: vi.fn().mockResolvedValue({connected:false}), pair: vi.fn().mockResolvedValue(undefined), sessions: vi.fn().mockResolvedValue([session]), timeline: vi.fn().mockResolvedValue([{role:'assistant',content:'已完成验证',timestamp:''}]), disconnect: vi.fn().mockResolvedValue(undefined) }; }
async function pair() {
  await screen.findByRole('button',{name:'连接电脑'});
  fireEvent.change(screen.getByLabelText('电脑地址'), {target:{value:'https://host.example'}});
  fireEvent.change(screen.getByLabelText('配对码'), {target:{value:'123456'}});
  fireEvent.click(screen.getByRole('button',{name:'连接电脑'}));
  await screen.findByText('修复配对');
}
describe('mobile connection and sessions', () => {
  it('keeps the pairing form hidden while startup validation is pending', async () => {
    const api=client(); let resolve!: (value: {connected:boolean})=>void;
    vi.mocked(api.restore).mockReturnValueOnce(new Promise(r=>{resolve=r;}));
    render(<MobileApp client={api}/>);
    expect(screen.queryByLabelText('配对码')).toBeNull();
    expect(api.sessions).not.toHaveBeenCalled();
    resolve({connected:false});
    await screen.findByRole('button',{name:'连接电脑'});
  });
  it('keeps forget retry available when credential deletion fails', async () => {
    const api=client(); vi.mocked(api.restore).mockRejectedValueOnce(new Error('离线'));
    vi.mocked(api.disconnect).mockRejectedValueOnce(new Error('无法删除保存的连接'));
    render(<MobileApp client={api}/>);
    fireEvent.click(await screen.findByRole('button',{name:'忘记连接'}));
    expect((await screen.findByRole('alert')).textContent).toBe('无法删除保存的连接');
    expect(screen.queryByLabelText('配对码')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'忘记连接'}));
    await screen.findByRole('button',{name:'连接电脑'});
  });
  it('validates saved credentials before showing sessions', async () => {
    const api=client(); vi.mocked(api.restore).mockResolvedValue({connected:true,host:'https://saved.example'});
    render(<MobileApp client={api}/>);
    await screen.findByText('修复配对');
    expect(screen.getByText('https://saved.example')).toBeTruthy();
    expect(api.pair).not.toHaveBeenCalled();
  });
  it('preserves offline credentials and retries restore', async () => {
    const api=client(); vi.mocked(api.restore).mockRejectedValueOnce(new Error('主机离线')).mockResolvedValueOnce({connected:true,host:'https://saved.example'});
    render(<MobileApp client={api}/>);
    fireEvent.click(await screen.findByRole('button',{name:'重试恢复'}));
    await screen.findByText('修复配对');
    expect(api.disconnect).not.toHaveBeenCalled();
  });
  it('returns to pairing when saved credentials are revoked', async () => {
    const api=client(); vi.mocked(api.restore).mockRejectedValueOnce(new Error('AUTH_REQUIRED: 请重新配对主机'));
    render(<MobileApp client={api}/>);
    await screen.findByRole('button',{name:'连接电脑'});
    expect(screen.getByRole('alert').textContent).toBe('请重新配对主机');
  });
  it('waits for credential deletion before returning to pairing', async () => {
    const api=client(); let resolve!: ()=>void;
    vi.mocked(api.restore).mockRejectedValueOnce(new Error('离线'));
    vi.mocked(api.disconnect).mockReturnValueOnce(new Promise(r=>{resolve=r;}));
    render(<MobileApp client={api}/>);
    fireEvent.click(await screen.findByRole('button',{name:'忘记连接'}));
    expect(screen.queryByRole('button',{name:'连接电脑'})).toBeNull();
    resolve();
    await screen.findByRole('button',{name:'连接电脑'});
  });
  it('renders unknown provider roles with neutral styling', async () => {
    const api=client(); vi.mocked(api.timeline).mockResolvedValue([{role:'developer custom',content:'provider message',timestamp:''}]);
    render(<MobileApp client={api}/>); await pair();
    fireEvent.click(screen.getByText('修复配对'));
    const message=await screen.findByText('provider message');
    expect(message.closest('article')?.className).toBe('message message-unknown');
    expect(screen.getByText('developer custom')).toBeTruthy();
  });
  it('pairs, reads the selected session and disconnects without retaining content', async () => {
    const api=client(); render(<MobileApp client={api}/>); await pair();
    expect(api.pair).toHaveBeenCalledWith('https://host.example','123456');
    fireEvent.click(screen.getByText('修复配对'));
    await screen.findByText('已完成验证');
    expect(api.timeline).toHaveBeenCalledWith('claude','s1');
    fireEvent.click(screen.getByRole('button',{name:'断开连接'}));
    await screen.findByRole('button',{name:'连接电脑'});
    expect(screen.queryByText('已完成验证')).toBeNull();
    expect((screen.getByLabelText('配对码') as HTMLInputElement).value).toBe('');
  });
  it('shows pair failures and allows retry', async () => {
    const api=client(); vi.mocked(api.pair).mockRejectedValueOnce(new Error('PAIR_REJECTED: 配对码无效'));
    render(<MobileApp client={api}/>);
    await screen.findByRole('button',{name:'连接电脑'});
  fireEvent.change(screen.getByLabelText('电脑地址'),{target:{value:'https://host.example'}});
    fireEvent.change(screen.getByLabelText('配对码'),{target:{value:'bad'}});
    fireEvent.click(screen.getByRole('button',{name:'连接电脑'}));
    expect((await screen.findByRole('alert')).textContent).toBe('配对码无效');
    expect((screen.getByLabelText('配对码') as HTMLInputElement).value).toBe('bad');
    expect((screen.getByLabelText('电脑地址') as HTMLInputElement).value).toBe('https://host.example');
    expect(api.sessions).not.toHaveBeenCalled();
    await pair();
  });
  it('does not restore stale results after disconnect', async () => {
    const api=client(); let resolve!: (value: Session[])=>void;
    render(<MobileApp client={api}/>); await pair();
    vi.mocked(api.sessions).mockReturnValueOnce(new Promise(r=>{resolve=r;}));
    fireEvent.click(screen.getByRole('button',{name:'刷新会话'}));
    fireEvent.click(screen.getByRole('button',{name:'断开连接'}));
    await screen.findByRole('button',{name:'连接电脑'});
    resolve([session]);
    await waitFor(()=>expect(screen.queryByText('修复配对')).toBeNull());
  });
  it('handles revoked credentials even after leaving the requesting view', async () => {
    const api=client(); let reject!: (reason: Error)=>void;
    vi.mocked(api.timeline).mockReturnValueOnce(new Promise((_,r)=>{reject=r;}));
    render(<MobileApp client={api}/>); await pair();
    fireEvent.click(screen.getByText('修复配对'));
    fireEvent.click(screen.getByRole('button',{name:'← 返回会话'}));
    reject(new Error('AUTH_REQUIRED: 请重新配对主机'));
    await screen.findByRole('button',{name:'连接电脑'});
    expect(screen.getByRole('alert').textContent).toBe('请重新配对主机');
    expect(screen.queryByText('修复配对')).toBeNull();
  });
  it('shows an empty list without inventing running state', async () => {
    const api=client(); vi.mocked(api.sessions).mockResolvedValue([]);
    render(<MobileApp client={api}/>);
    await screen.findByRole('button',{name:'连接电脑'});
  fireEvent.change(screen.getByLabelText('电脑地址'),{target:{value:'https://host.example'}});
    fireEvent.change(screen.getByLabelText('配对码'),{target:{value:'123'}});
    fireEvent.click(screen.getByRole('button',{name:'连接电脑'}));
    await screen.findByText('还没有会话记录');
  });
});
