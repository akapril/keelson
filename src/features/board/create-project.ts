// 创建项目的前端编排逻辑，含补偿事务（创建失败时回滚主记录）。
// 唯一使用 lib/pb/board.ts 的 createRecord / deleteRecord；不直接调用 pb.collection。
import { createRecord, deleteRecord } from "../../lib/pb/board";
import { COL } from "../../lib/pb/collections";
import { currentUserId } from "../../lib/pb";
import { normalizeSortOrders } from "../../store/board-rank";
import type { BoardTemplate, BoardProject } from "../../types/board";

// ── 输入参数类型 ───────────────────────────────────────────────
export interface CreateProjectInput {
  name: string;
  description?: string;
  repo_path?: string;
  template: BoardTemplate;
}

/**
 * 从模板创建看板项目（前端编排 + 补偿事务）。
 *
 * 步骤：
 * 1. 创建 board_projects 主记录（owner = 当前用户）。
 * 2. 按模板批量创建 board_project_states（sort_order 由 normalizeSortOrders 生成）。
 * 3. 按模板批量创建 board_project_labels。
 *
 * 补偿：步骤 2/3 中任一失败，立即删除步骤 1 创建的项目记录（PB 级联删除子记录），
 * 然后重新抛出原始错误，确保不留孤立数据。
 */
export async function createProjectFromTemplate(
  input: CreateProjectInput,
): Promise<BoardProject> {
  const { name, description, repo_path, template } = input;

  // ── 步骤 1：创建项目主记录 ────────────────────────────────
  const projectData: Record<string, unknown> = {
    owner: currentUserId(),
    name,
    archived: false,
  };
  if (description != null && description !== "") projectData.description = description;
  if (repo_path != null && repo_path !== "") projectData.repo_path = repo_path;

  const project = await createRecord<BoardProject>(COL.boardProjects, projectData);
  const projId = project.id;

  try {
    // ── 步骤 2：批量创建状态列 ────────────────────────────────
    const sortOrders = normalizeSortOrders(template.states.length);
    await Promise.all(
      template.states.map((state, i) =>
        createRecord(COL.boardStates, {
          project: projId,
          name: state.name,
          color: state.color,
          category: state.category,
          sort_order: sortOrders[i],
        }),
      ),
    );

    // ── 步骤 3：批量创建标签 ──────────────────────────────────
    if (template.labels && template.labels.length > 0) {
      await Promise.all(
        template.labels.map((label) =>
          createRecord(COL.boardLabels, {
            project: projId,
            name: label.name,
            color: label.color,
          }),
        ),
      );
    }
  } catch (err) {
    // 补偿：删除主记录（PB 级联删除子记录），然后重新抛出
    await deleteRecord(COL.boardProjects, projId).catch(() => {
      // 补偿删除失败时忽略（避免掩盖原始错误）
    });
    throw err;
  }

  return project;
}
