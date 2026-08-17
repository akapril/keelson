// agent_profiles PB 数据访问层 —— 唯一允许调用 pb.collection('agent_profiles') 的文件。
import { pb } from "../pb";
import { softDeleteRecord, NOT_DELETED } from "./collections";
import type { AgentProfile } from "../../types/agent-profile";

const COLL = "agent_profiles";

/** 全部队友（未软删，按 updated 降序）。owner 范围由访问规则保证。 */
export function listAgents(): Promise<AgentProfile[]> {
  return pb.collection(COLL).getFullList<AgentProfile>({ requestKey: null, filter: NOT_DELETED, sort: "-updated" });
}
export function createAgentRecord(data: Record<string, unknown>): Promise<AgentProfile> {
  return pb.collection(COLL).create<AgentProfile>(data);
}
export function updateAgentRecord(id: string, data: Record<string, unknown>): Promise<AgentProfile> {
  return pb.collection(COLL).update<AgentProfile>(id, data);
}
export function softDeleteAgent(id: string): Promise<void> {
  return softDeleteRecord(COLL, id);
}
