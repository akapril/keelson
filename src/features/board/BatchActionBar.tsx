// BatchActionBar —— 多选模式底部批量操作栏。
// 浮现于看板底部（多选模式且选中 >0 时由 KanbanBoard 渲染）。
// 操作：移动到状态列 / 改优先级 / 删除（二次确认）/ 退出多选。
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import type { BoardState, TaskPriority } from "@/types/board";
import { PRIORITY_META, PRIORITY_ORDER } from "./board-meta";
import { cn } from "@/lib/utils";

interface BatchActionBarProps {
  /** 当前已选任务数量（>0 才渲染） */
  selectedCount: number;
  /** 可供选择的目标状态列（排好序） */
  states: BoardState[];
  /** 批量移动到指定状态列 */
  onMove: (toStateId: string) => Promise<void>;
  /** 批量改优先级 */
  onPriority: (priority: TaskPriority) => Promise<void>;
  /** 批量删除（调用前已通过 AlertDialog 二次确认） */
  onDelete: () => Promise<void>;
  /** 退出多选模式 */
  onExit: () => void;
}

/**
 * 批量操作栏：固定在看板底部，提供移动/优先级/删除/退出四个操作。
 * 使用语义色（bg-card/border-border）而非硬编码颜色。
 */
export function BatchActionBar({
  selectedCount,
  states,
  onMove,
  onPriority,
  onDelete,
  onExit,
}: BatchActionBarProps) {
  const { t } = useTranslation("board");
  return (
    <div
      className={cn(
        "mt-2 flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 shadow-md",
        "flex-wrap",
      )}
    >
      {/* 已选计数 */}
      <span className="shrink-0 text-sm font-medium text-foreground">
        {t("batch.selectedCount", { count: selectedCount })}
      </span>

      <div className="mx-1 h-4 w-px shrink-0 bg-border" />

      {/* 移动到目标状态列 */}
      <Select onValueChange={(val) => void onMove(val)}>
        <SelectTrigger className="h-8 w-36 text-xs">
          <SelectValue placeholder={t("batch.movePlaceholder")} />
        </SelectTrigger>
        <SelectContent>
          {states.map((st) => (
            <SelectItem key={st.id} value={st.id}>
              <div className="flex items-center gap-1.5">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: st.color }}
                />
                {st.name}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* 改优先级 */}
      <Select onValueChange={(val) => void onPriority(val as TaskPriority)}>
        <SelectTrigger className="h-8 w-32 text-xs">
          <SelectValue placeholder={t("batch.priorityPlaceholder")} />
        </SelectTrigger>
        <SelectContent>
          {PRIORITY_ORDER.map((p) => (
            <SelectItem key={p} value={p}>
              <div className="flex items-center gap-1.5">
                <span
                  className={cn("size-1.5 shrink-0 rounded-full", PRIORITY_META[p].dot)}
                />
                {t(`meta.priority.${p}`)}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* 删除（AlertDialog 二次确认） */}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive" size="sm" className="h-8 text-xs">
            {t("common:action.delete")}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("batch.confirmDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("batch.confirmDeleteDesc", { count: selectedCount })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common:action.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void onDelete()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("batch.confirmDeleteAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 退出多选（推到末尾） */}
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto h-8 text-xs"
        onClick={onExit}
      >
        {t("batch.exitSelect")}
      </Button>
    </div>
  );
}
