// 文档图片附件 —— 唯一允许调用 doc_assets 集合的文件。
// 上传：把图片写入 PB file 字段，返回不含 token 的稳定 URL（存进 Markdown 正文）。
// 渲染：受保护文件需文件 token，proxyDomURL 钩子在展示时追加新鲜 token（token ~2h 过期，故不入正文）。
import { pb, currentUserId } from "../pb";
import { COL } from "./collections";

interface DocAssetRecord {
  id: string;
  file: string;
  collectionId: string;
  collectionName: string;
}

/**
 * 上传一张图片到 doc_assets，返回稳定文件 URL（不带 token）。
 * 供 Milkdown image-block 的 onUpload 使用：返回值会被写进 Markdown 的 ![](url)。
 */
export async function uploadDocAsset(file: File): Promise<string> {
  const form = new FormData();
  form.append("owner", currentUserId());
  form.append("file", file);
  const rec = await pb.collection(COL.docAssets).create<DocAssetRecord>(form);
  // 只存与端口无关的**相对路径**（/api/files/...）进 Markdown：本地 PB 端口在 dev 下随机、
  // 重启会变，存绝对 URL（含端口）会在重启后端口失效 → 图裂。渲染时由 resolveAssetURL
  // 拼上当前 baseURL + 新鲜 token。
  const full = pb.files.getURL(rec, rec.file);
  const idx = full.indexOf("/api/files/");
  return idx >= 0 ? full.slice(idx) : full;
}

/**
 * 渲染钩子（proxyDomURL）：把文档里的 PB 文件引用归一到**当前** PB 实例并追加新鲜文件 token。
 * - 提取 `/api/files/...` 路径后用当前 baseURL 重新拼接：既支持新存的相对路径，
 *   也**自动修复历史正文里烤死的绝对 URL（旧随机端口）**——重启后不再图裂，无需迁移。
 * - 非 PB 文件（外链图片，不含 /api/files/）原样返回；已带 token 的也原样返回。
 */
export async function resolveAssetURL(url: string): Promise<string> {
  if (!url || url.includes("token=")) return url;
  const idx = url.indexOf("/api/files/");
  if (idx < 0) return url; // 外链图片，原样返回
  const base = pb.baseURL.replace(/\/+$/, "");
  const rebased = `${base}${url.slice(idx)}`; // 丢弃原 host:port（可能是失效的旧端口），重定位到当前实例
  try {
    const token = await pb.files.getToken();
    if (!token) return rebased;
    const sep = rebased.includes("?") ? "&" : "?";
    return `${rebased}${sep}token=${token}`;
  } catch {
    // 取 token 失败则退回重定位后的 URL（可能加载失败，但不阻断渲染）
    return rebased;
  }
}
