export type CreatorStatus = "pending" | "selected" | "discarded";
export type CreatorPlatform = "xiaohongshu";

export interface Creator {
  id: string;
  platform: CreatorPlatform;
  name: string;
  handle: string;
  followers: number;
  activity: number;
  match: number;
  tags: string[];
  evidence: string;
  status: CreatorStatus;
  group: string;
  contact: string;
  discardReason?: string;
  updatedAt: string;
  /** 璇ヨ揪浜洪娆¤繘鍏ュ綋鍓嶉」鐩殑妫€绱㈡椂闂?*/
  firstSearchAt?: string;
  /** 鐪熷疄鏁版嵁锛氳揪浜轰富椤甸摼鎺ワ紙缂虹渷鍥為€€ /user/profile/{id}锛?*/
  profileUrl?: string;
  /** 鐪熷疄鏁版嵁锛氳揪浜哄ご鍍?*/
  avatar?: string;
}

export interface KnowledgeBase {
  id: string;
  name: string;
  status: "ready" | "outdated";
  documentCount: number;
  updatedAt: string;
}

