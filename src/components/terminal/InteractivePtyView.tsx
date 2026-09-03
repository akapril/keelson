/**
 * InteractivePtyView.tsx — 交互式 PTY 终端视图（桌面进程管理）
 *
 * 与 XtermView 结构一致（xterm + FitAddon + safeFit + 语义色主题），但传输换成 Tauri：
 *   输出：listen("runtime-pty-output:<id>") → term.write(Uint8Array)
 *   输入：term.onData → ipc.runtimePtyInput(id, data)
 *   尺寸：ResizeObserver → ipc.runtimePtyResize(id, cols, rows)
 *   退出：listen("runtime-pty-exit:<id>") → 显示 [process exited]
 */
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ipc } from "@/lib/tauri/ipc";
import { createXtermCore } from "./xterm-shared";

export function InteractivePtyView({
  id,
  className,
}: {
  id: string;
  className?: string;
}) {
  const { t } = useTranslation("board");
  const containerRef = useRef<HTMLDivElement>(null);
  // t 经 ref 取最新，避免语言切换重挂终端
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    if (!containerRef.current) return;

    // 创建终端核心（new Terminal + FitAddon + 挂载 + WebGL + 主题实时跟随 + safeFit，
    // 见 createXtermCore；与 web 终端复用同一套样板，桌面端同样获得主题实时切换）。
    const core = createXtermCore(containerRef.current);
    const { term, safeFit } = core;

    // 键入 → stdin（term.onData 发出 xterm 解码后的字符序列）
    const dataDisposable = term.onData((data) => {
      void ipc.runtimePtyInput(id, data);
    });

    // 订阅输出 / 退出事件（listen 返回 Promise<Unlisten>，卸载时解绑）
    const unlisteners: UnlistenFn[] = [];

    // 输出事件：将字节写入终端
    void listen<number[]>(`runtime-pty-output:${id}`, (e) => {
      term.write(new Uint8Array(e.payload));
    }).then((un) => unlisteners.push(un));

    // 退出事件：显示退出提示（通过 tRef 取最新翻译，无需重挂终端）
    void listen(`runtime-pty-exit:${id}`, () => {
      term.writeln(`\r\n\x1b[2m${tRef.current("processes.pty.exited")}\x1b[0m`);
    }).then((un) => unlisteners.push(un));

    // 尺寸变化 → resize（safeFit 跳过隐藏态，返回 true 才同步尺寸）
    const observer = new ResizeObserver(() => {
      if (safeFit()) void ipc.runtimePtyResize(id, term.cols, term.rows);
    });
    observer.observe(containerRef.current);

    // 挂载后同步一次权威尺寸（WS 连接前的 resize 可能丢失，补发）
    if (safeFit()) void ipc.runtimePtyResize(id, term.cols, term.rows);

    // 清理：卸载时解绑所有事件监听 + 释放 xterm 资源
    return () => {
      observer.disconnect();
      dataDisposable.dispose();
      // 解绑 Tauri 事件监听（已注册的按序调用，未注册的不在数组里）
      unlisteners.forEach((un) => un());
      // 拆完监听再 core.dispose()（内部按序：主题 observer → WebGL → term.dispose）
      core.dispose();
    };
  }, [id]); // deps 仅保留进程 id；t 经 tRef 传递，不纳入

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: "100%", height: "100%", overflow: "hidden" }}
      aria-label="Interactive terminal"
      role="region"
    />
  );
}
