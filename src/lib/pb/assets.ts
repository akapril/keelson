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
  // 稳定 URL：受保护文件在渲染时由 resolveAssetURL 追加 token
  return pb.files.getURL(rec, rec.file);
}

/**
 * 渲染钩子（proxyDomURL）：为指向本地 PB 的文件 URL 追加新鲜文件 token。
 * 非本 PB 的图片（外链）原样返回；已带 token 的也原样返回。
 */
export async function resolveAssetURL(url: string): Promise<string> {
  if (!url || url.includes("token=")) return url;
  // 仅处理本 PB 实例的受保护文件（doc_assets 是唯一 file 集合）
  if (!url.startsWith(pb.baseURL) || !url.includes("/api/files/")) return url;
  try {
    const token = await pb.files.getToken();
    if (!token) return url;
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}token=${token}`;
  } catch {
    // 取 token 失败则退回原 URL（可能加载失败，但不阻断渲染）
    return url;
  }
}
