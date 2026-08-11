/**
 * webterm-ws.ts — 终端 WebSocket 客户端封装
 *
 * 协议约定（对齐 Task 11 /ws/terminal/:id）：
 *   收 Binary 帧 → pty 输出字节流 → onData(Uint8Array)
 *   收 Text 帧 + JSON {type:"exit"} → pty 退出 → onExit()
 *   发 Text（非 JSON）→ stdin（键盘输入）
 *   发 Text JSON {type:"resize",cols:C,rows:R} → 终端尺寸变化
 */

/** 连接状态 */
export type WsStatus = "connecting" | "connected" | "reconnecting" | "closed";

/** 回调接口 */
export interface TermCallbacks {
  onData: (bytes: Uint8Array) => void;
  onExit: () => void;
  onStatus: (s: WsStatus) => void;
}

/** openTerminalWs 返回的控制句柄 */
export interface TermWsHandle {
  /** 发送 stdin 文本 */
  send: (data: string) => void;
  /** 发送终端尺寸变化帧 */
  resize: (cols: number, rows: number) => void;
  /** 主动关闭（不触发重连） */
  close: () => void;
}

/** 退避重连参数 */
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8000;
const RECONNECT_MAX_ATTEMPTS = 8;

/**
 * 打开到 /ws/terminal/:id 的 WebSocket，处理帧分发与断线重连。
 *
 * @param id          终端会话 ID（对应后端 pty 进程）
 * @param params      查询参数 {provider, path}
 * @param callbacks   数据/退出/状态回调
 * @returns           控制句柄（send/resize/close）
 */
export function openTerminalWs(
  id: string,
  params: { provider: string; path: string },
  callbacks: TermCallbacks
): TermWsHandle {
  let ws: WebSocket | null = null;
  let manualClose = false; // 主动调用 close() 时标记，阻止重连
  // pty 进程已退出（收到 {type:"exit"} 帧）。这是**权威终止信号**：进程没了，重连也只会
  // 让后端重新 open→再次拉起同一个必然失败的会话（如 codex resume 到不兼容的 rollout），
  // 形成"闪错→重连→再闪错"的死循环。故一旦 exit，后续 onclose 一律按主动关闭处理，不重连。
  // 反之：网络抖动断线时后端**不发** exit 帧且不杀 pty（进程仍活），此时才应重连并接管。
  let exited = false;
  let attempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /** 构建同源 WS URL */
  function buildUrl(): string {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const query = `provider=${encodeURIComponent(params.provider)}&path=${encodeURIComponent(params.path)}`;
    return `${proto}://${location.host}/ws/terminal/${encodeURIComponent(id)}?${query}`;
  }

  /** 取消待定的重连定时器 */
  function cancelReconnect(): void {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  /** 计算退避延迟（指数 + 抖动） */
  function backoffMs(): number {
    const exp = Math.min(RECONNECT_BASE_MS * 2 ** attempts, RECONNECT_MAX_MS);
    return exp * (0.8 + Math.random() * 0.4); // ±20% 抖动
  }

  /** 建立（或重建）WebSocket 连接 */
  function connect(): void {
    callbacks.onStatus(attempts === 0 ? "connecting" : "reconnecting");

    const socket = new WebSocket(buildUrl());
    socket.binaryType = "arraybuffer";
    ws = socket;

    socket.onopen = () => {
      attempts = 0;
      callbacks.onStatus("connected");
    };

    socket.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        // Binary 帧 → pty 输出
        callbacks.onData(new Uint8Array(ev.data));
      } else if (typeof ev.data === "string") {
        // Text 帧 → 尝试 JSON 解析
        try {
          const msg = JSON.parse(ev.data) as { type?: string };
          if (msg.type === "exit") {
            exited = true; // 标记进程已退出：随后的 onclose 不得触发重连
            callbacks.onExit();
          }
          // 其他 JSON 消息类型：忽略（预留扩展）
        } catch {
          // 非 JSON 文本帧：当前协议中不应出现；忽略以保持健壮性
        }
      }
    };

    socket.onerror = () => {
      // onerror 之后必然触发 onclose，在 onclose 统一处理重连
    };

    socket.onclose = (ev) => {
      ws = null;
      if (manualClose || exited) {
        // 主动关闭 或 pty 已退出：均不重连（exited 见上方注释——避免死循环重连必然失败的会话）
        callbacks.onStatus("closed");
        return;
      }
      // 非正常关闭（code !== 1000）或协议异常 → 退避重连
      attempts += 1;
      if (attempts > RECONNECT_MAX_ATTEMPTS) {
        callbacks.onStatus("closed");
        return;
      }
      // code 1000 = 正常关闭（pty 进程退出），也视为"closed"不重连
      if (ev.code === 1000) {
        callbacks.onStatus("closed");
        return;
      }
      const delay = backoffMs();
      callbacks.onStatus("reconnecting");
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };
  }

  /** 安全发送文本（ws 已连接时） */
  function safeSend(data: string): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }

  connect();

  return {
    /** 发送 stdin 文本（非 JSON，直接透传到 pty） */
    send(data: string): void {
      safeSend(data);
    },

    /** 发送终端尺寸变化 JSON 帧 */
    resize(cols: number, rows: number): void {
      safeSend(JSON.stringify({ type: "resize", cols, rows }));
    },

    /** 主动关闭，阻止重连。onStatus("closed") 统一由 onclose handler 触发，避免双调用。 */
    close(): void {
      manualClose = true;
      cancelReconnect();
      if (ws) {
        // 不在此处置 ws = null，让浏览器异步触发 onclose 后由 handler 完成清理。
        // 不主动调 onStatus("closed")——onclose 的 manualClose 分支会调一次。
        ws.close();
      }
    },
  };
}
