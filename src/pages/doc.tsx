// 全页文档编辑器 /docs/:id —— 专业写作页：标题 + Milkdown(斜杠菜单/KaTeX/AI) + 右侧大纲 TOC。
// /docs 列表与项目「文档」标签点开均跳此页；改动防抖自动保存；所属项目多选(0..N)。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  FolderOpenIcon,
  Delete02Icon,
  ListViewIcon,
  LinkSquare02Icon,
} from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
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
  MilkdownDocumentEditor,
  type DocumentEditorMode,
} from "@/features/docs/MilkdownDocumentEditor";
import { parseHeadings } from "@/features/docs/toc";
import { parseWikiLinks, contentLinksTo } from "@/features/docs/wiki-links";
import { openDocWindow, closeThisWindow } from "@/lib/tauri/window";
import {
  getDocRecord,
  updateDocRecord,
  deleteDocRecord,
  listAllDocs,
} from "@/lib/pb/docs";
import { listProjects } from "@/lib/pb/board";
import type { BoardDoc } from "@/types/docs";
import type { BoardProject } from "@/types/board";

export default function DocPage({ windowMode = false }: { windowMode?: boolean }) {
  const { id = "" } = useParams();
  const navigate = useNavigate();

  const [doc, setDoc] = useState<BoardDoc | null>(null);
  const [projects, setProjects] = useState<BoardProject[]>([]);
  const [allDocs, setAllDocs] = useState<BoardDoc[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [mode, setMode] = useState<DocumentEditorMode>("rich-text");
  const [loadState, setLoadState] = useState<"loading" | "ready" | "missing">("loading");

  // 最近已保存值（避免自动保存把「刚保存的结果」再当作变更循环触发）
  const savedRef = useRef({ title: "", content: "" });
  // 编辑器根容器（供 TOC 点击滚动定位标题）
  const editorWrapRef = useRef<HTMLDivElement>(null);

  // 加载文档 + 项目列表
  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    void getDocRecord(id)
      .then((d) => {
        if (cancelled) return;
        setDoc(d);
        setTitle(d.title);
        setContent(d.content);
        setProjectIds(d.projects ?? []);
        savedRef.current = { title: d.title, content: d.content };
        setLoadState("ready");
      })
      .catch(() => {
        if (!cancelled) setLoadState("missing");
      });
    void listProjects().then((ps) => !cancelled && setProjects(ps)).catch(() => {});
    // 全部文档：用于 Wiki 双链的出链解析与反向链接计算
    void listAllDocs().then((ds) => !cancelled && setAllDocs(ds)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id]);

  // 标题/正文防抖自动保存（700ms）
  useEffect(() => {
    if (loadState !== "ready") return;
    if (title === savedRef.current.title && content === savedRef.current.content) return;
    const t = setTimeout(() => {
      void updateDocRecord(id, { title: title.trim() || "未命名文档", content })
        .then((updated) => {
          savedRef.current = { title: updated.title, content: updated.content };
        })
        .catch((e) => toast.error(`保存失败：${String(e)}`));
    }, 700);
    return () => clearTimeout(t);
  }, [title, content, id, loadState]);

  // 切换文档与某项目的链接（可挂多个、也可全解绑变游离档）
  const toggleProject = (pid: string) => {
    const next = projectIds.includes(pid)
      ? projectIds.filter((p) => p !== pid)
      : [...projectIds, pid];
    setProjectIds(next);
    void updateDocRecord(id, { projects: next }).catch((e) =>
      toast.error(`更新归属失败：${String(e)}`),
    );
  };

  const handleDelete = async () => {
    try {
      await deleteDocRecord(id);
      if (windowMode) void closeThisWindow();
      else navigate("/docs");
    } catch (e) {
      toast.error(`删除失败：${String(e)}`);
    }
  };

  // 大纲：从正文解析标题（跳过代码块内 #）
  const headings = useMemo(() => parseHeadings(content), [content]);

  // Wiki 双链：出链（本文 [[标题]] 解析到的文档）+ 反向链接（引用了本文标题的文档）
  const titleToDoc = useMemo(() => {
    const m = new Map<string, BoardDoc>();
    for (const d of allDocs) if (d.title) m.set(d.title.trim().toLowerCase(), d);
    return m;
  }, [allDocs]);

  const outLinks = useMemo(() => {
    // 解析到的目标标题 → { target, doc?(命中则可跳转) }
    return parseWikiLinks(content).map((target) => ({
      target,
      doc: titleToDoc.get(target.toLowerCase()),
    }));
  }, [content, titleToDoc]);

  const backLinks = useMemo(() => {
    const t = (title || "").trim();
    if (!t) return [];
    return allDocs.filter((d) => d.id !== id && contentLinksTo(d.content, t));
  }, [allDocs, id, title]);

  const hasAside = headings.length > 0 || outLinks.length > 0 || backLinks.length > 0;

  // 点击大纲项：滚动到富文本中第 index 个标题（source/diff 模式先切回富文本）
  const scrollToHeading = useCallback(
    (index: number) => {
      const doScroll = () => {
        const nodes = editorWrapRef.current?.querySelectorAll<HTMLElement>(
          ".milkdown .ProseMirror :is(h1,h2,h3,h4,h5,h6)",
        );
        nodes?.[index]?.scrollIntoView({ behavior: "smooth", block: "start" });
      };
      if (mode !== "rich-text") {
        setMode("rich-text");
        // 等富文本区渲染出来再滚
        setTimeout(doScroll, 60);
      } else {
        doScroll();
      }
    },
    [mode],
  );

  const projectName = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects],
  );

  if (loadState === "loading") {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        加载文档中…
      </div>
    );
  }
  if (loadState === "missing" || !doc) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <span>文档不存在或已被删除。</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => (windowMode ? void closeThisWindow() : navigate("/docs"))}
        >
          {windowMode ? "关闭窗口" : "返回文档列表"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col p-6">
      {/* 头部：返回 + 标题 + 所属项目 + 删除 */}
      <div className="mb-3 flex shrink-0 items-center gap-2">
        {/* 独立窗口下窗口控制交给自建标题栏，这里不再重复返回/关闭按钮 */}
        {!windowMode && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => navigate(-1)}
            aria-label="返回"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
          </Button>
        )}
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="文档标题"
          className="h-9 flex-1 border-0 bg-transparent px-1 text-base font-semibold shadow-none focus-visible:ring-0"
        />
        {/* 新窗口打开（仅主窗口内；独立窗口里自身即窗口，不再显示） */}
        {!windowMode && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="在新窗口打开"
            title="在独立窗口打开"
            onClick={() => void openDocWindow(id, title)}
          >
            <HugeiconsIcon icon={LinkSquare02Icon} strokeWidth={2} />
          </Button>
        )}
        {/* 所属项目（0..N） */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5 text-muted-foreground">
              <HugeiconsIcon icon={FolderOpenIcon} strokeWidth={2} />
              {projectIds.length === 0 ? "未归类" : `${projectIds.length} 个项目`}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-72 w-56 overflow-y-auto">
            <DropdownMenuLabel>链接到项目（可不选=未归类）</DropdownMenuLabel>
            {projects.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">暂无项目</p>
            ) : (
              projects.map((p) => (
                <DropdownMenuCheckboxItem
                  key={p.id}
                  checked={projectIds.includes(p.id)}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={() => toggleProject(p.id)}
                >
                  <span className="truncate">{p.name}</span>
                </DropdownMenuCheckboxItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="删除文档"
              className="text-muted-foreground hover:text-destructive"
            >
              <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>删除此文档？</AlertDialogTitle>
              <AlertDialogDescription>
                「{title || "未命名文档"}」将被永久删除，无法恢复。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => void handleDelete()}>
                删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* 所属项目胶囊（只读展示，便于确认归属） */}
      {projectIds.length > 0 && (
        <div className="mb-2 flex shrink-0 flex-wrap gap-1.5">
          {projectIds.map((pid) => (
            <span
              key={pid}
              className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
            >
              {projectName.get(pid) ?? "未知项目"}
            </span>
          ))}
        </div>
      )}

      {/* 主体：编辑器 + 右侧大纲 TOC */}
      <div className="flex min-h-0 flex-1 gap-4">
        <div
          ref={editorWrapRef}
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border"
        >
          <MilkdownDocumentEditor
            key={doc.id}
            value={content}
            savedValue={savedRef.current.content}
            mode={mode}
            onModeChange={setMode}
            onChange={setContent}
          />
        </div>

        {/* 右侧栏：大纲 TOC + Wiki 双链（出链/反向链接） */}
        {hasAside && (
          <nav className="hidden w-56 shrink-0 flex-col gap-5 overflow-y-auto lg:flex">
            {headings.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <HugeiconsIcon icon={ListViewIcon} strokeWidth={2} className="size-3.5" />
                  大纲
                </div>
                <ul className="flex flex-col gap-0.5">
                  {headings.map((h) => (
                    <li key={h.index}>
                      <button
                        type="button"
                        onClick={() => scrollToHeading(h.index)}
                        className="block w-full truncate rounded-md px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        style={{ paddingLeft: `${(h.level - 1) * 12 + 8}px` }}
                        title={h.text}
                      >
                        {h.text}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* 出链：本文用 [[标题]] 引用的其它文档（命中可点跳转，未命中灰显） */}
            {outLinks.length > 0 && (
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  出链 · [[…]]
                </div>
                <ul className="flex flex-col gap-0.5">
                  {outLinks.map((l, i) =>
                    l.doc ? (
                      <li key={`${l.target}-${i}`}>
                        <button
                          type="button"
                          onClick={() => navigate(`/docs/${l.doc!.id}`)}
                          className="block w-full truncate rounded-md px-2 py-1 text-left text-xs text-primary transition-colors hover:bg-muted"
                          title={l.target}
                        >
                          {l.target}
                        </button>
                      </li>
                    ) : (
                      <li
                        key={`${l.target}-${i}`}
                        className="truncate px-2 py-1 text-xs text-muted-foreground/50"
                        title="未找到同名文档"
                      >
                        {l.target}（未创建）
                      </li>
                    ),
                  )}
                </ul>
              </div>
            )}

            {/* 反向链接：其它文档用 [[本文标题]] 引用了本文 */}
            {backLinks.length > 0 && (
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  反向链接（{backLinks.length}）
                </div>
                <ul className="flex flex-col gap-0.5">
                  {backLinks.map((d) => (
                    <li key={d.id}>
                      <button
                        type="button"
                        onClick={() => navigate(`/docs/${d.id}`)}
                        className="block w-full truncate rounded-md px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        title={d.title}
                      >
                        {d.title || "未命名文档"}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </nav>
        )}
      </div>
    </div>
  );
}
