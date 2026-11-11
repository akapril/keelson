import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { nativeClient } from './client';
import type { MobileClient, MobileTimelineMessage } from './client';
import type { Session } from '../types/session';

const roleLabels = new Map([['user','你'],['assistant','助手'],['system','系统'],['tool','工具']]);

export function MobileApp({ client = nativeClient }: { client?: MobileClient }) {
  const [host, setHost] = useState('');
  const [code, setCode] = useState('');
  const [connected, setConnected] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selected, setSelected] = useState<Session | null>(null);
  const [messages, setMessages] = useState<MobileTimelineMessage[]>([]);
  const [restoring, setRestoring] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const connectionEpoch = useRef(0);
  useEffect(() => {
    restore();
    return () => { generation.current++; connectionEpoch.current++; };
    // The injected transport is fixed for this mounted app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function restore() {
    setRestoring(true);
    void run(async current => {
      const result = await client.restore();
      if (!current()) return;
      setRestoring(false);
      if (!result.connected) return;
      setHost(result.host ?? ''); setConnected(true);
      const list = await client.sessions();
      if (current()) setSessions(list);
    });
  }

  function clear() { connectionEpoch.current++; setRestoring(false); setConnected(false); setSessions([]); setMessages([]); setSelected(null); setCode(''); }
  function fail(reason: unknown) {
    const text = reason instanceof Error ? reason.message : String(reason);
    if (text.includes('AUTH_REQUIRED:')) clear();
    setError(text.replace(/^(AUTH_REQUIRED|PAIR_REJECTED|FEATURE_DISABLED):\s*/, ''));
  }
  async function run(action: (current: () => boolean) => Promise<void>) {
    const id = ++generation.current;
    const epoch = connectionEpoch.current;
    const current = () => id === generation.current;
    setBusy(true); setError('');
    try { await action(current); } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      // Navigation makes view data stale, but cannot undo revocation of this connection.
      if (text.startsWith('AUTH_REQUIRED:') && epoch === connectionEpoch.current) {
        generation.current++; setBusy(false); fail(e);
      } else if (current()) fail(e);
    }
    finally { if (current()) setBusy(false); }
  }
  function connect(event: FormEvent) {
    event.preventDefault();
    void run(async current => {
      try { await client.pair(host.trim(), code.trim()); }
      catch (reason) {
        const text = reason instanceof Error ? reason.message : String(reason);
        throw new Error(text.replace(/^AUTH_REQUIRED:/, 'PAIR_REJECTED:'));
      }
      if (!current()) return;
      setConnected(true); setCode('');
      const result = await client.sessions();
      if (current()) setSessions(result);
    });
  }
  function refresh() {
    void run(async current => { const result = await client.sessions(); if (current()) setSessions(result); });
  }
  function open(session: Session) {
    setSelected(session); setMessages([]);
    void run(async current => {
      const result = await client.timeline(session.provider, session.session_id);
      if (current()) setMessages(result);
    });
  }
  async function disconnect() {
    const id = ++generation.current;
    connectionEpoch.current++;
    setBusy(true); setError(''); setConnected(false); setRestoring(true);
    setSessions([]); setMessages([]); setSelected(null);
    try { await client.disconnect(); if (id === generation.current) clear(); }
    catch (e) { if (id === generation.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (id === generation.current) setBusy(false); }
  }
  function back() { ++generation.current; setSelected(null); setMessages([]); setError(''); setBusy(false); }
  const formatTime = (value: string) => { const date = new Date(value); return Number.isNaN(date.valueOf()) ? '' : date.toLocaleString('zh-CN', {month:'numeric', day:'numeric', hour:'2-digit',minute:'2-digit'}); };

  return <main className="mobile-app">
    <header className="mobile-header"><span className="wordmark">Keelson<span className="wordmark-dot">.</span></span><span className="edition">MOBILE / PREVIEW</span></header>
    <div className="connection-status"><span className={connected ? 'status-dot online' : 'status-dot'}/>{connected ? host.trim() : '尚未连接电脑'}</div>
    {connected && <div className="mobile-toolbar"><span>会话记录 · 只读预览</span><button className="text-button" onClick={() => void disconnect()}>断开连接</button></div>}
    {error && <div className="mobile-error" role="alert">{error}</div>}
    {restoring ? <section className="connect-section" aria-busy={busy}>
      <h1>恢复电脑连接</h1>
      {busy ? <p role="status">正在处理连接…</p> : <>
        <p className="intro">暂时无法恢复连接。你可以重试，或忘记此连接后重新配对。</p>
        <button className="primary-button" onClick={restore}>重试恢复</button>
        <button className="text-button" onClick={() => void disconnect()}>忘记连接</button>
      </>}
    </section> : !connected ? <section className="connect-section">
      <p className="eyebrow">YOUR WORK, WITH YOU</p>
      <h1>离开桌面，<br/>工作仍在眼前。</h1>
      <p className="intro">连接运行 Keelson 的电脑，查看 AI 会话与对话记录。</p>
      <form onSubmit={connect} className="connect-form">
        <label htmlFor="mobile-host">电脑地址</label>
        <input id="mobile-host" type="url" inputMode="url" autoCapitalize="none" spellCheck={false} autoComplete="off" placeholder="https://your-computer.example" value={host} onChange={e=>setHost(e.target.value)} required disabled={busy}/>
        <label htmlFor="mobile-code">配对码</label>
        <input id="mobile-code" type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="输入电脑上显示的配对码" value={code} onChange={e=>setCode(e.target.value)} required disabled={busy}/>
        <button className="primary-button" disabled={busy}>{busy ? '正在连接…' : '连接电脑'}</button>
      </form>
      <div className="setup-help"><h2>在电脑上准备</h2><p>打开 Keelson 设置中的 Web 网关，使用具有有效证书的 HTTPS 地址，并输入当前配对码。电脑需要保持在线。</p><p>Android 会安全保存配对，重启后自动验证并恢复连接；iOS 当前仅在本次运行期间保持连接。终端输入与原生通知将在后续阶段加入。</p></div>
    </section> : selected ? <section className="session-detail" aria-busy={busy}>
      <button className="text-button back-button" onClick={back}>← 返回会话</button>
      <p className="eyebrow">{selected.provider} / {selected.project_name}</p>
      <h1>{selected.first_prompt || '未命名会话'}</h1>
      {busy ? <p role="status">正在读取记录…</p> : messages.length === 0 && !error ? <p className="empty-state">此会话暂无可读记录</p> : null}
      <div className="timeline">{messages.map((message,index)=><article className={`message message-${roleLabels.has(message.role) ? message.role : 'unknown'}`} key={`${message.timestamp}-${index}`}>
        <header><strong>{roleLabels.get(message.role) ?? (message.role || '消息')}</strong><time>{formatTime(message.timestamp)}</time></header>
        <div className="message-content">{message.content}</div>
      </article>)}</div>
      {error && <button onClick={()=>open(selected)} className="primary-button" disabled={busy}>重新读取</button>}
    </section> : <section className="sessions-section" aria-busy={busy}>
      <div className="section-heading"><div><p className="eyebrow">ON YOUR COMPUTER</p><h1>最近会话</h1></div><button className="text-button" onClick={refresh} disabled={busy}>刷新会话</button></div>
      {busy && <p role="status">正在读取会话…</p>}
      {!busy && !error && sessions.length===0 && <p className="empty-state">还没有会话记录</p>}
      <ul className="session-list">{sessions.map(session=><li key={`${session.provider}:${session.session_id}`}><button onClick={()=>open(session)} disabled={busy}>
        <span className="session-meta"><span>{session.provider} · {session.project_name}</span><time>{formatTime(session.updated_at)}</time></span>
        <strong>{session.first_prompt || '未命名会话'}</strong>
        <span className="session-foot">{session.message_count} 条消息 <span aria-hidden="true">↗</span></span>
      </button></li>)}</ul>
    </section>}
  </main>;
}
