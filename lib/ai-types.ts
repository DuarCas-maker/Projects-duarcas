export type AiClaim = { text: string; sourceIds: string[] };
export type AiSuggestion = { projectId: string; title: string; description: string; priority: number; urgency: number; estimatedMinutes: number; deadline: string | null; reason: string; evidenceIds: string[]; impact: string; confidence: number; matchedTaskIds?: string[]; responsibleNames?: string[] };
export type AiResult = { answer: string; facts: AiClaim[]; inferences: AiClaim[]; suggestions: AiSuggestion[] };
export type AiRecord = { id: string; query: string; result: AiResult; createdAt: string; kind: string; sources?: Record<string,string>; memory?: {status:string;count:number;warning?:string} };
