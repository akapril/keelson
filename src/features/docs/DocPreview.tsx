// 文档只读预览：渲染 Markdown 且把 ```mermaid 代码块渲染成图表。
// 独立于富文本编辑节点（不改编辑器内部），坏了也只影响「预览」视图，不波及编辑，风险可控。
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import mermaid from "mermaid";
import { cn } from "@/lib/utils";

// 单个 mermaid 图块：异步渲染为 SVG；失败则回退显示源码 + 错误。
function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    // 跟随明暗主题；每次渲染前初始化（幂等，成本低）
    const dark = document.documentElement.classList.contains("dark");
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: dark ? "dark" : "default",
    });
    // 唯一 id（浏览器运行时，Math.random 可用）
    const id = `mmd-${Math.random().toString(36).slice(2)}`;
    mermaid
      .render(id, code)
      .then((r) => {
        if (alive) {
          setSvg(r.svg);
          setErr(null);
        }
      })
      .catch((e: unknown) => {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [code]);

  if (err) {
    return (
      <pre className="my-3 overflow-x-auto rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
        {`⚠ mermaid 渲染失败：${err}\n\n${code}`}
      </pre>
    );
  }
  return (
    <div
      className="my-3 flex justify-center overflow-x-auto"
      // svg 来自本地 mermaid(securityLevel:strict 已净化)，仅渲染图形
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export function DocPreview({ content, className }: { content: string; className?: string }) {
  return (
    <div
      className={cn(
        "min-h-0 flex-1 overflow-y-auto px-5 py-4 text-sm leading-relaxed",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (props) => <h1 className="mb-3 mt-4 text-xl font-semibold" {...props} />,
          h2: (props) => <h2 className="mb-2 mt-4 text-lg font-semibold" {...props} />,
          h3: (props) => <h3 className="mb-2 mt-3 text-base font-semibold" {...props} />,
          p: (props) => <p className="my-2 break-words" {...props} />,
          ul: (props) => <ul className="my-2 list-disc space-y-1 pl-6" {...props} />,
          ol: (props) => <ol className="my-2 list-decimal space-y-1 pl-6" {...props} />,
          a: (props) => (
            <a
              className="text-primary underline underline-offset-2 hover:opacity-80"
              target="_blank"
              rel="noreferrer"
              {...props}
            />
          ),
          blockquote: (props) => (
            <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground" {...props} />
          ),
          table: (props) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-xs" {...props} />
            </div>
          ),
          th: (props) => <th className="border border-border bg-muted px-2 py-1 text-left font-medium" {...props} />,
          td: (props) => <td className="border border-border px-2 py-1" {...props} />,
          hr: () => <hr className="my-4 border-border" />,
          pre: (props) => <>{props.children}</>,
          code: ({ className: c, children, ...rest }: React.ComponentProps<"code"> & { inline?: boolean }) => {
            const inline = (rest as { inline?: boolean }).inline;
            const text = String(children ?? "");
            // ```mermaid → 渲染图表
            if (!inline && /language-mermaid/.test(c || "")) {
              return <MermaidBlock code={text.replace(/\n$/, "")} />;
            }
            if (inline) {
              return (
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]" {...rest}>
                  {children}
                </code>
              );
            }
            return (
              <pre className="my-2 overflow-x-auto rounded-lg bg-muted p-3 text-[0.85em]">
                <code className={cn("font-mono", c)}>{children}</code>
              </pre>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
