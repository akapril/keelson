// Notifications PB SDK 数据访问层 —— 唯一允许调用 pb.collection 的通知文件。
import { pb } from "../pb";
import { COL } from "./collections";
import { currentUserId } from "../pb";
import type { AppNotification, NotificationKind } from "../../types/notifications";

/** 获取当前用户全部通知（按 created 降序，最新在前）。 */
export function listNotifications(): Promise<AppNotification[]> {
  return pb
    .collection(COL.notifications)
    .getFullList<AppNotification>({ requestKey: null, sort: "-created" });
}

/** 新建通知的输入（owner/read/created 由本层或后端补齐）。 */
export interface CreateNotificationInput {
  title: string;
  body?: string;
  kind?: NotificationKind;
  link?: string;
  source?: string;
}

/** 创建一条通知（供更新/AI/沉淀等来源推送）。 */
export function createNotification(
  input: CreateNotificationInput,
): Promise<AppNotification> {
  return pb.collection(COL.notifications).create<AppNotification>({
    owner: currentUserId(),
    title: input.title,
    body: input.body ?? "",
    kind: input.kind ?? "info",
    read: false,
    link: input.link ?? "",
    source: input.source ?? "",
  });
}

/** 标记单条为已读 / 未读。 */
export function setNotificationRead(id: string, read: boolean): Promise<AppNotification> {
  return pb.collection(COL.notifications).update<AppNotification>(id, { read });
}

/** 删除一条通知。 */
export function deleteNotification(id: string): Promise<void> {
  return pb.collection(COL.notifications).delete(id).then(() => undefined);
}

/** 订阅当前用户通知的实时变更；返回退订函数。 */
export async function subscribeNotifications(
  onEvent: (action: string, rec: AppNotification) => void,
): Promise<() => void> {
  const unsub = await pb
    .collection(COL.notifications)
    .subscribe<AppNotification>("*", (e) => onEvent(e.action, e.record));
  return () => {
    void unsub();
  };
}
