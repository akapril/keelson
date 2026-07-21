// 路由级错误边界：单个页面渲染抛错时兜底展示，避免白屏拖垮整个 app。
// fallbackKey 变化（如切换路由）时自动复位，重新进入其它页面不残留错误态。
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  /** 传 location.pathname：路由变化时自动清除错误态。 */
  fallbackKey?: string;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 记录到控制台便于排查（不上报，本地应用）
    console.error("[ErrorBoundary] 页面渲染出错：", error, info);
  }

  componentDidUpdate(prev: Props) {
    // 路由切换（fallbackKey 变）时复位错误态
    if (prev.fallbackKey !== this.props.fallbackKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-sm font-medium text-foreground">此页面出错了</p>
          <p className="max-w-md break-words text-xs text-muted-foreground">
            {error.message || String(error)}
          </p>
          <Button variant="outline" size="sm" onClick={() => this.setState({ error: null })}>
            重试
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
