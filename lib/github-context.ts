import type { Workspace } from "./workspace-types";

export const GITHUB_SOURCE_PREFIX = "github-snapshot:";
export const GITHUB_STATUS_PREFIX = "read_only:";
export type GithubSource = {
  version: 1; repositoryId: string; owner: string; repo: string; branch: string; sha: string;
  url: string; files: string[]; included: number; omitted: number; excluded: number; treeTruncated: boolean;
};
export function readGithubSource(item: Workspace["knowledge"][number]): GithubSource | null {
  if (item.itemType !== "repository" || !item.sourceReference?.startsWith(GITHUB_SOURCE_PREFIX)) return null;
  try {
    const source = JSON.parse(item.sourceReference.slice(GITHUB_SOURCE_PREFIX.length)) as GithubSource;
    if (source.version !== 1 || !/^[a-zA-Z0-9_-]{1,100}$/.test(source.repositoryId) || !/^[a-f0-9]{40}$/.test(source.sha) ||
      !/^[a-zA-Z0-9-]{1,39}$/.test(source.owner) || !/^[a-zA-Z0-9_.-]{1,100}$/.test(source.repo) ||
      typeof source.branch !== "string" || source.url !== `https://github.com/${source.owner}/${source.repo}/tree/${source.sha}` ||
      !Array.isArray(source.files) || !source.files.every(path => typeof path === "string" && path.length <= 300) ||
      source.files.length !== source.included || typeof source.treeTruncated !== "boolean" ||
      ![source.included, source.omitted, source.excluded].every(n => Number.isSafeInteger(n) && n >= 0)) return null;
    return source;
  } catch { return null; }
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
