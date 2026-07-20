// Markdown —— 轻量 markdown 渲染（react-markdown + GFM）。用于 AI 对话气泡等只读展示。
// 用组件级 Tailwind 覆盖排版（不引 prose 插件）；颜色走中性主题语义 token。
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

export function Markdown({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn("text-sm leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: (props) => <p className="my-2 whitespace-pre-wrap break-words" {...props} />,
          h1: (props) => <h1 className="mb-2 mt-3 text-base font-semibold" {...props} />,
          h2: (props) => <h2 className="mb-2 mt-3 text-sm font-semibold" {...props} />,
          h3: (props) => <h3 className="mb-1.5 mt-2.5 text-sm font-semibold" {...props} />,
          ul: (props) => <ul className="my-2 list-disc space-y-1 pl-5" {...props} />,
          ol: (props) => <ol className="my-2 list-decimal space-y-1 pl-5" {...props} />,
          li: (props) => <li className="marker:text-muted-foreground" {...props} />,
          a: (props) => (
            <a className="text-primary underline underline-offset-2 hover:opacity-80" target="_blank" rel="noreferrer" {...props} />
          ),
          blockquote: (props) => (
            <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground" {...props} />
          ),
          // 行内代码 vs 代码块：react-markdown v10 用 inline 属性区分
          code: ({ className: c, children, ...rest }: React.ComponentProps<"code"> & { inline?: boolean }) => {
            const inline = (rest as { inline?: boolean }).inline;
            if (inline) {
              return (
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]" {...rest}>
                  {children}
                </code>
              );
            }
            return (
              <code className={cn("font-mono text-[0.85em]", c)} {...rest}>
                {children}
              </code>
            );
          },
          pre: (props) => (
            <pre className="my-2 overflow-x-auto rounded-lg bg-muted p-3 text-[0.85em]" {...props} />
          ),
          table: (props) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-xs" {...props} />
            </div>
          ),
          th: (props) => <th className="border border-border bg-muted px-2 py-1 text-left font-medium" {...props} />,
          td: (props) => <td className="border border-border px-2 py-1" {...props} />,
          hr: () => <hr className="my-3 border-border" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
