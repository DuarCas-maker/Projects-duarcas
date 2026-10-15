export type BrainHit = { id: string; knowledgeId: string; projectId: string; title: string; text: string; sourceReference: string; score: number };
export type BrainMemory = { status: "connected" | "not_configured" | "unavailable"; hits: BrainHit[]; warning?: string; coverage?:import("./project-sources").SourceCoverage; provider?:"local"|"local_and_gbrain"|"gbrain" };
export type BrainLink = { knowledgeId: string; title: string; status: string; error: string; indexedAt: string | null };
export type BrainStatus = { configured: boolean; enabled: boolean; connected: boolean; used: number; limit: number; links: BrainLink[]; ai?:{configured:boolean;enabled:boolean;used:number;limit:number}; error?: string };
