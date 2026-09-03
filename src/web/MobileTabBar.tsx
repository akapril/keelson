// web/MobileTabBar.tsx — 移动端底部内容 tab 栏（可长按拖拽排序）
//
// 交互：点击 = 切 tab；长按(≥200ms)后拖动 = 排序（PointerSensor 延时激活，短点不误触拖拽）。
// 顺序由父层持久化到 localStorage。仅 <lg 显示（桌面走侧栏）。
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { restrictToHorizontalAxis, restrictToParentElement } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { TabIcon, type TabKey } from "./tabs";

/** 单个可排序 tab 按钮：整按钮既是拖拽把手也是点击切换（靠 PointerSensor 延时区分）。 */
function SortableTab({
  tab,
  active,
  label,
  onSelect,
}: {
  tab: TabKey;
  active: boolean;
  label: string;
  onSelect: (tab: TabKey) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <button
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      type="button"
      onClick={() => onSelect(tab)}
      aria-current={active ? "page" : undefined}
      className={`flex flex-1 touch-none flex-col items-center gap-1 px-2 py-2.5 text-xs transition-colors ${
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <TabIcon tab={tab} active={active} />
      <span>{label}</span>
    </button>
  );
}

export interface MobileTabBarProps {
  /** 当前顺序（已 normalize 的内容 tab 数组） */
  order: TabKey[];
  /** 当前激活 tab */
  activeTab: TabKey;
  /** 切换 tab */
  onSelect: (tab: TabKey) => void;
  /** 排序变化（父层持久化） */
  onReorder: (next: TabKey[]) => void;
  /** i18n 取 tab 文案 */
  label: (tab: TabKey) => string;
  /** 无障碍标签 */
  ariaLabel: string;
}

/** 移动端底栏：内容 tab 横排，可长按拖拽排序。 */
export function MobileTabBar({ order, activeTab, onSelect, onReorder, label, ariaLabel }: MobileTabBarProps) {
  // 延时激活：按住 200ms 才进入拖拽，短点仍触发 onClick 切 tab（tolerance 容忍轻微抖动）。
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = order.indexOf(active.id as TabKey);
    const newIndex = order.indexOf(over.id as TabKey);
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(arrayMove(order, oldIndex, newIndex));
  };
  return (
    <nav
      className="shrink-0 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 lg:hidden"
      aria-label={ariaLabel}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToHorizontalAxis, restrictToParentElement]}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={order} strategy={horizontalListSortingStrategy}>
          <div className="mx-auto flex max-w-3xl">
            {order.map((tab) => (
              <SortableTab
                key={tab}
                tab={tab}
                active={tab === activeTab}
                label={label(tab)}
                onSelect={onSelect}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </nav>
  );
}
