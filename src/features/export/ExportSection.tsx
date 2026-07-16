// 设置页「数据导出」区：一键把看板 + 文档导出为 JSON（备份）或 Markdown（可读）。
import { useState } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Download04Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import {
  gatherExport,
  toJson,
  toMarkdown,
  downloadTextFile,
} from "./export-data";

/** 用当前日期拼文件名，如 rework-export-20260716。 */
function stamp(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
}

export function ExportSection() {
  const [busy, setBusy] = useState<null | "json" | "md">(null);

  async function run(format: "json" | "md") {
    if (busy) return;
    setBusy(format);
    try {
      const now = new Date();
      const bundle = await gatherExport(now.toISOString());
      const projectCount = bundle.projects.length;
      if (projectCount === 0) {
        toast.info("暂无项目可导出");
        return;
      }
      if (format === "json") {
        downloadTextFile(
          `rework-export-${stamp(now)}.json`,
          toJson(bundle),
          "application/json",
        );
      } else {
        downloadTextFile(
          `rework-export-${stamp(now)}.md`,
          toMarkdown(bundle),
          "text/markdown",
        );
      }
      toast.success(`已导出 ${projectCount} 个项目的看板与文档`);
    } catch (e) {
      toast.error(`导出失败：${String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">数据导出</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          导出全部项目的看板与文档（会话记录已存在于本地文件，无需导出）。
          JSON 为完整备份，Markdown 便于阅读/归档。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() => void run("json")}
        >
          <HugeiconsIcon icon={Download04Icon} strokeWidth={2} />
          {busy === "json" ? "导出中…" : "导出 JSON"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() => void run("md")}
        >
          <HugeiconsIcon icon={Download04Icon} strokeWidth={2} />
          {busy === "md" ? "导出中…" : "导出 Markdown"}
        </Button>
      </div>
    </section>
  );
}
