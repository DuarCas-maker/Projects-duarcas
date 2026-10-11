import type * as schema from "@/db/schema";

export type Project = typeof schema.projects.$inferSelect;
export type Task = typeof schema.tasks.$inferSelect;
export type Milestone = typeof schema.milestones.$inferSelect;
export type Financial = typeof schema.projectFinancials.$inferSelect;
export type Workspace = {
  projects: Project[]; tasks: Task[]; milestones: Milestone[];
  dependencies: (typeof schema.taskDependencies.$inferSelect)[];
  financials: Financial[]; events: (typeof schema.projectEvents.$inferSelect)[];
  suggestions: (typeof schema.aiSuggestions.$inferSelect)[];
  inbox: (typeof schema.inboxItems.$inferSelect)[];
  calendar: (typeof schema.calendarBlocks.$inferSelect)[];
  knowledge: (typeof schema.knowledgeItems.$inferSelect)[];
  repositories: (typeof schema.repositories.$inferSelect)[];
  operations?: (typeof schema.projectOperations.$inferSelect)[];
};

export function emptyWorkspace(): Workspace {
  return { projects: [], tasks: [], milestones: [], dependencies: [], financials: [], events: [], suggestions: [], inbox: [], calendar: [], knowledge: [], repositories: [], operations: [] };
}

export function deriveWorkspaceState(state: Workspace): Workspace {
  return { ...state, milestones: [...state.milestones].sort((a, b) => a.position - b.position), tasks: state.tasks.map((task) => {
    if (["completed", "cancelled"].includes(task.status)) return { ...task, isBlocked: false, blockingReason: null };
    const edges = state.dependencies.filter((edge) => edge.taskId === task.id);
    if (!edges.length) return task;
    const waiting = edges.map((edge) => state.tasks.find((item) => item.id === edge.dependsOnTaskId)).filter((item) => !item || item.status !== "completed");
    const manual = task.status === "blocked";
    return { ...task, isBlocked: manual || waiting.length > 0, blockingReason: manual ? task.blockingReason : waiting.length ? `Depende de: ${waiting.map((item) => item?.title ?? "tarea no disponible").join(", ")}` : null };
  }) };
}
