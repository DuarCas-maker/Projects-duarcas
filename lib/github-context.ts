import type { Workspace } from "./workspace-types";

export const GITHUB_SOURCE_PREFIX = "github-snapshot:";
export const GITHUB_STATUS_PREFIX = "read_only:";
export type GithubActivity = {
  message: string; committedAt: string | null; previousSha: string | null;
  comparison: "initial" | "ahead" | "behind" | "diverged" | "identical" | "unavailable";
  aheadBy: number | null; behindBy: number | null;
  files: { path: string; status: string }[]; partial: boolean;
};
export type GithubSource = {
  version: 1; repositoryId: string; owner: string; repo: string; branch: string; sha: string;
  url: string; files: string[]; included: number; omitted: number; excluded: number; treeTruncated: boolean;
  activity?: GithubActivity;
};
export function validGithubActivity(value: unknown): value is GithubActivity {
  const a = value as GithubActivity;
  return !!a && typeof a.message === "string" && a.message.length <= 1000 &&
    (a.committedAt === null || (typeof a.committedAt === "string" && /^\d{4}-\d{2}-\d{2}T/.test(a.committedAt) && Number.isFinite(Date.parse(a.committedAt)))) &&
    (a.previousSha === null || (typeof a.previousSha === "string" && /^[a-f0-9]{40}$/.test(a.previousSha))) &&
    ["initial","ahead","behind","diverged","identical","unavailable"].includes(a.comparison) &&
    (a.comparison === "initial" ? a.previousSha === null : a.previousSha !== null) &&
    [a.aheadBy,a.behindBy].every(n => n === null || (Number.isSafeInteger(n) && n! >= 0)) &&
    Array.isArray(a.files) && a.files.length <= 20 && a.files.every(f => f && typeof f.path === "string" && f.path.length <= 300 && typeof f.status === "string" && ["added","removed","modified","renamed","copied","changed","unchanged"].includes(f.status)) && typeof a.partial === "boolean";
}
export function readGithubSource(item: Workspace["knowledge"][number]): GithubSource | null {
  if (item.itemType !== "repository" || !item.sourceReference?.startsWith(GITHUB_SOURCE_PREFIX)) return null;
  try {
    const source = JSON.parse(item.sourceReference.slice(GITHUB_SOURCE_PREFIX.length)) as GithubSource;
    if (source.version !== 1 || !/^[a-zA-Z0-9_-]{1,100}$/.test(source.repositoryId) || !/^[a-f0-9]{40}$/.test(source.sha) ||
      !/^[a-zA-Z0-9-]{1,39}$/.test(source.owner) || !/^[a-zA-Z0-9_.-]{1,100}$/.test(source.repo) ||
      typeof source.branch !== "string" || source.url !== `https://github.com/${source.owner}/${source.repo}/tree/${source.sha}` ||
      !Array.isArray(source.files) || !source.files.every(path => typeof path === "string" && path.length <= 300) ||
      source.files.length !== source.included || typeof source.treeTruncated !== "boolean" ||
      ![source.included, source.omitted, source.excluded].every(n => Number.isSafeInteger(n) && n >= 0) ||
      (source.activity !== undefined && !validGithubActivity(source.activity))) return null;
    return source;
  } catch { return null; }
}

export type RepositoryFollowup = {
  id: string; title: string; branch: string; lastSync: string | null;
  knowledgeId: string | null; sha: string | null; url: string | null;
  included: number; omitted: number; treeTruncated: boolean; activity: GithubActivity | null;
};
export type RepositoryFollowupInput = { knowledgeId: string; text: string; excerpt: boolean; unavailable: boolean };
export function repositoryFollowup(state: Workspace, userId: string, projectId: string): RepositoryFollowup[] {
  if (!state.projects.some(p => p.id === projectId && p.userId === userId)) return [];
  const sources = projectRepositorySources(state,userId,projectId);
  return state.repositories.filter(r => r.userId === userId && r.projectId === projectId && r.provider === "github").map(r => {
    const saved = sources.find(s => s.repository.id === r.id);
    return {id:r.id,title:`${r.owner}/${r.repo}`,branch:r.defaultBranch,lastSync:r.lastSync,knowledgeId:saved?.item.id ?? null,sha:saved?.source.sha ?? null,url:saved?.source.url ?? null,included:saved?.source.included ?? 0,omitted:saved?.source.omitted ?? 0,treeTruncated:saved?.source.treeTruncated ?? false,activity:saved?.source.activity ?? null};
  });
}
export function projectRepositorySources(state: Workspace, userId: string, projectId: string) {
  if (!state.projects.some(p => p.id === projectId && p.userId === userId)) return [];
  return state.repositories.filter(r => r.userId === userId && r.projectId === projectId && r.provider === "github").flatMap(repository => {
    if (!repository.status.startsWith(GITHUB_STATUS_PREFIX)) return [];
    const id = repository.status.slice(GITHUB_STATUS_PREFIX.length);
    const item = state.knowledge.find(k => k.id === id && k.userId === userId && k.projectId === projectId);
    const source = item && readGithubSource(item);
    if (!item || !source || source.repositoryId !== repository.id || source.owner.toLowerCase() !== repository.owner.toLowerCase() ||
      source.repo.toLowerCase() !== repository.repo.toLowerCase() || source.branch !== repository.defaultBranch) return [];
    return [{ repository, item, source }];
  });
}
