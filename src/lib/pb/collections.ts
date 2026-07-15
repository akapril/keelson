import { pb } from "../pb";
export const COL = {
  sessionsMeta: "sessions_meta",
  sessionTags: "session_tags",
  sessionNotes: "session_notes",
} as const;
export const list = <T>(coll: string, opts: Record<string, unknown> = {}) =>
  pb.collection(coll).getFullList<T>({ requestKey: null, ...opts });
export const create = <T>(coll: string, data: Record<string, unknown>) =>
  pb.collection(coll).create<T>(data);
export const update = <T>(coll: string, id: string, data: Record<string, unknown>) =>
  pb.collection(coll).update<T>(id, data);
