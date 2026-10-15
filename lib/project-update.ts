import { executionTasks,mergeEventText } from "./task-structure";
import { activeKnowledge } from "./task-attachments";
import type { Workspace } from "./workspace-types";
import type { BrainMemory } from "./brain-types";
import { bogotaDay, eligibleTasks, rankTask } from "./daily-engine";
import { readMeeting } from "./meetings";
import { FINDING_LABELS, type MeetingAnalysis } from "./meeting-analysis";
import { buildCoreCommand, CoreValidationError } from "./core-commands";
import { repositoryFollowup, projectRepositorySources, type RepositoryFollowup, type RepositoryFollowupInput } from "./github-context";
import { operationsFor, assignmentLabel, financeTotals, detailFor } from "./project-operations";
import { selectedSourceCoverage, type SourceCoverage } from "./project-sources";

export type UpdateClaim = { text: string; sourceIds: string[] };
export type ProjectUpdateResult = {
  summary: string; summarySourceIds: string[]; changes: UpdateClaim[];
  pending: UpdateClaim[]; risks: UpdateClaim[];
  technicalActivity?: UpdateClaim[];
  nextAction: { taskId: string | null; title: string; reason: string; sourceIds: string[] };
};
export type UpdateItem = { id: string; title: string; description: string; type: string };
export type ProjectUpdateSnapshot = {
  projectId: string; meeting: { id: string; title: string; date: string; status: MeetingAnalysis["status"]; completedParts: number; totalParts: number } | null;
  applied: UpdateItem[]; recent:UpdateItem[]; pending: UpdateItem[]; unreviewedCount: number;
  counts: { open: number; completed: number; blocked: number; overdue: number };
  candidates: { id: string; title: string; reason: string; priority: number; minutes: number }[];
  repositories: RepositoryFollowup[];
};
export type ProjectUpdateRecord = {
  id: string; createdAt: string; revision: string; result: ProjectUpdateResult;
  sources: Record<string, string>; memory: { status: string; count: number; warning?: string };
  coverage?:{included:number;omitted:number};
  sourceCoverage?:SourceCoverage;
  repositories?: (RepositoryFollowup & { excerpt: boolean; unavailable: boolean; used: boolean })[];
};

export function projectUpdateSignature(state: Workspace, projectId: string, meetingId: string) {
  const scopedTasks = state.tasks.filter(t => t.projectId === projectId), taskIds = new Set(scopedTasks.map(t => t.id));
  const sort = <T extends { id: string }>(rows: T[]) => [...rows].sort((a,b) => a.id.localeCompare(b.id));
  return JSON.stringify({ day: bogotaDay(), meetingId,
    project: state.projects.find(p => p.id === projectId), tasks: sort(scopedTasks),
    dependencies: sort(state.dependencies.filter(d => taskIds.has(d.taskId))),
    milestones: sort(state.milestones.filter(m => m.projectId === projectId)),
    financials: sort(state.financials.filter(f => f.projectId === projectId)),
    events: sort(state.events.filter(e => e.projectId === projectId)),
    suggestions: sort(state.suggestions.filter(s => s.projectId === projectId)),
    knowledge: sort(activeKnowledge(state).filter(k => k.projectId === projectId)),
    repositories: sort(state.repositories.filter(r => r.projectId === projectId)),
    operations: (state.operations ?? []).filter(o => o.projectId === projectId),
  });
}

export function projectUpdateSnapshot(state: Workspace, projectId: string, meetingId: string, analysis: MeetingAnalysis): ProjectUpdateSnapshot {
  const project = state.projects.find(p => p.id === projectId);
  if (!project) throw new CoreValidationError("Proyecto no encontrado.",404);
  const item = meetingId ? state.knowledge.find(k => k.id === meetingId && k.projectId === projectId && k.userId === project.userId) : undefined;
  const meeting = item && readMeeting(item);
  if (meetingId && (!item || !meeting)) throw new CoreValidationError("La reunión no pertenece a este proyecto.",404);
  const proposals = state.suggestions.filter(s => s.projectId === projectId).flatMap(s => {
    try { const payload = JSON.parse(s.payload); return !meetingId || (payload.meetingId === meetingId && payload.meetingFingerprint === meeting?.fingerprint) ? [{...s,payload}] : []; }
    catch { return []; }
  });
  const reviewed = new Set(proposals.map(s => s.payload.findingId));
  const applied: UpdateItem[] = [];
  // Only actual tasks and approved history events count as applied. A pending
  // suggestion, extracted date or meeting summary is not an operational change.
  for (const proposal of proposals.filter(s => s.status === "approved")) {
    const task = state.tasks.find(t => t.projectId === projectId && t.sourceId === proposal.id && t.approved);
    if (task) applied.push({id:task.id,title:task.title,description:`Tarea aprobada · ${task.status}${task.deadline ? ` · fecha ${task.deadline}` : ""}`,type:"task"});
  }
  const events = state.events.filter(e => e.projectId === projectId && (meetingId
    ? e.sourceId === meetingId && e.sourceType === "meeting" && e.eventType.startsWith("meeting_")
    : e.eventType !== "organization" && e.eventType !== "capture"));
  for (const event of [...events].sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0,20)) {
    applied.push({id:event.id,title:event.title,description:mergeEventText(event),type:"event"});
  }
  const recent = meeting ? state.events.filter(e=>e.projectId===projectId && !applied.some(row=>row.id===e.id) && ["project","task","milestone","payment","financial"].includes(e.eventType) && bogotaDay(new Date(e.eventDate))>=meeting.date).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,20).map(e=>({id:e.id,title:e.title,description:mergeEventText(e),type:"dated_history"})) : [];
  const pending = proposals.filter(s => s.status === "pending").map(s => ({id:s.id,title:s.title,description:s.reason,type:"proposal"}));
  const unreviewed = analysis.status === "ready" ? analysis.findings.filter(f => !reviewed.has(f.id)) : [];
  for (const finding of unreviewed) pending.push({id:`finding:${meetingId}:${finding.id}`,title:finding.title,description:`${FINDING_LABELS[finding.kind]} detectada; aún no enviada a aprobación. ${finding.description}`,type:"finding"});
  const tasks = executionTasks(state.tasks).filter(t => t.projectId === projectId), open = tasks.filter(t => !["completed","cancelled"].includes(t.status));
  return { projectId, meeting: item && meeting ? {id:item.id,title:item.title,date:meeting.date,status:analysis.status,completedParts:analysis.completedParts,totalParts:analysis.totalParts} : null,
    applied, recent, pending, unreviewedCount:unreviewed.length,
    repositories:repositoryFollowup(state,project.userId,projectId),
    counts:{open:open.length,completed:tasks.filter(t => t.status === "completed").length,blocked:open.filter(t => t.isBlocked).length,overdue:open.filter(t => t.deadline && t.deadline < bogotaDay()).length},
    candidates:eligibleTasks(state).filter(t => t.projectId === projectId).slice(0,5).map(t => ({id:t.id,title:t.title,reason:rankTask(t,state).reason,priority:t.priority,minutes:t.estimatedMinutes})),
  };
}

export function projectUpdateContext(state: Workspace, snapshot: ProjectUpdateSnapshot, analysis: MeetingAnalysis, memory: BrainMemory, repositoryContext: RepositoryFollowupInput[] = []) {
  const project = state.projects.find(p => p.id === snapshot.projectId)!;
  const records: {id:string;type:string;data:unknown}[] = [{id:project.id,type:"project",data:{name:project.name,description:project.description,currentSummary:project.currentSummary,nextStepSummary:project.nextStepSummary,operationalStatus:project.operationalStatus,commercialStatus:project.commercialStatus,priority:project.priority,strategicPriority:project.strategicPriority,blockedReason:project.blockedReason,targetEndDate:project.targetEndDate}},
    {id:`status:${project.id}`,type:"current_counts",data:{...snapshot.counts,candidates:snapshot.candidates}}];
  const add = (id:string,type:string,data:unknown) => records.push({id,type,data});
  const activeSources = projectRepositorySources(state,project.userId,project.id), activeIds = new Set(activeSources.map(s=>s.item.id));
  const repos = repositoryFollowup(state,project.userId,project.id);
  const scopedMemory = memory.hits.filter(h => h.projectId === project.id && (!h.knowledgeId || !state.knowledge.some(k=>k.id===h.knowledgeId && k.itemType==="repository") || activeIds.has(h.knowledgeId)));
  // The same verified source excerpts used by Intelligence are reserved early.
  scopedMemory.forEach(row=>add(row.id,"project_source_excerpt",row));
  // Put ranked tasks and independently bounded repository excerpts early so
  // large meeting/history records cannot crowd out the whole technical view.
  const taskContext = (task: Workspace["tasks"][number]) => { const { userId: _, ...row } = task, operations = operationsFor(state, project.id), detail = detailFor(operations, task.id); return { ...row, assignment: assignmentLabel(operations, task.id), plannedStart: detail.plannedStart, plannedEnd: detail.plannedEnd, ranking: rankTask(task, state) }; };
  for (const candidate of snapshot.candidates) {const task=state.tasks.find(t=>t.id===candidate.id)!;if(!records.some(r=>r.id===task.id)) add(task.id,"task",taskContext(task));}
  for (const repo of repos) {
    const original = repositoryContext.find(r=>r.knowledgeId===repo.knowledgeId);
    add(repo.knowledgeId ?? repo.id,"github_snapshot_NOT_operational_completion",{...repo,text:original?.text ?? "",excerpt:original?.excerpt ?? false,originalUnavailable:!!repo.knowledgeId && (!original || original.unavailable),notLive:true});
  }
  if (snapshot.meeting) add(snapshot.meeting.id,"meeting_analysis_NOT_operational_state",{...snapshot.meeting,summaries:analysis.summaries});
  snapshot.applied.forEach(row => add(row.id,"approved_change",row));
  snapshot.recent.forEach(row=>add(row.id,"other_confirmed_change_since_meeting_DATE_NOT_CAUSED_BY_MEETING",row));
  activeKnowledge(state).filter(k=>k.projectId===project.id && k.userId===project.userId && !["meeting","repository"].includes(k.itemType)).slice().sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt)).forEach(k=>add(k.id,"local_knowledge_summary_NOT_full_document",{title:k.title,itemType:k.itemType,summary:k.summary,occurredAt:k.occurredAt}));
  scopedMemory.filter(row=>!records.some(r=>r.id===row.id)).forEach(row => add(row.id,"gbrain_retrieved_excerpt_NOT_entire_memory",row));
  snapshot.pending.forEach(row => add(row.id,"pending_NOT_applied",row));
  const tasks = state.tasks.filter(t => t.projectId === project.id).sort((a,b) => rankTask(b,state).score-rankTask(a,state).score);
  for (const task of tasks) if (!records.some(r => r.id === task.id)) add(task.id,"task",taskContext(task));
  state.milestones.filter(m => m.projectId === project.id).forEach(({userId:_,...row}) => add(row.id,"milestone",row));
  state.financials.filter(f => f.projectId === project.id && !operationsFor(state, project.id).agreements.some(a => a.legacy)).forEach(({userId:_,...row}) => add(row.id,"legacy_financial",row));
  financeTotals(state, project.id).forEach(row => add("finance_" + project.id + "_" + row.currency, "financial", row));
  operationsFor(state, project.id).people.filter(p => p.active).forEach(p => add(p.id, "person", { name: p.name, role: p.role }));
  state.events.filter(e => e.projectId === project.id && !records.some(r => r.id === e.id)).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0,20).forEach(({userId:_,...row}) => add(row.id,"history",row));
  // Complete records only, with visible coverage limits. Never silently cut a
  // transcript or turn a model finding into a confirmed project status.
  const selected: typeof records = []; let size = 0, omitted = 0;
  for (const record of records) {const length=JSON.stringify(record).length;if(size+length>44000){omitted++;continue;}selected.push(record);size+=length;}
  const sources = new Set(selected.map(r => r.id));
  const names:Record<string,string>={project_source_excerpt:"Fuente del proyecto · contenido",project:"Proyecto",current_counts:"Estado y prioridades",meeting_analysis_NOT_operational_state:"Análisis de reunión · no confirmado",approved_change:"Cambio confirmado",other_confirmed_change_since_meeting_DATE_NOT_CAUSED_BY_MEETING:"Historial desde la fecha",pending_NOT_applied:"Pendiente · no aplicado",task:"Tarea",milestone:"Hito",financial:"Finanzas",history:"Historial",gbrain_retrieved_excerpt_NOT_entire_memory:"Memoria GBrain",github_snapshot_NOT_operational_completion:"GitHub · versión guardada",local_knowledge_summary_NOT_full_document:"Fuente local · resumen"};
  const labels = Object.fromEntries(selected.map(r => {const data=r.data as {title?:string;name?:string};return [r.id,`${names[r.type]??r.type}: ${data.title ?? data.name ?? (r.id.startsWith("status:") ? "Recuento y prioridades actuales" : r.id)}`];}));
  return {sources,labels,sourceCoverage:selectedSourceCoverage(memory.coverage,sources,omitted),omittedRecords:omitted,memoryCount:selected.filter(r=>["project_source_excerpt","gbrain_retrieved_excerpt_NOT_entire_memory"].includes(r.type)).length,repositories:repos.map(repo=>{const original=repositoryContext.find(r=>r.knowledgeId===repo.knowledgeId);return {...repo,excerpt:original?.excerpt ?? false,unavailable:!!repo.knowledgeId && (!original || original.unavailable),used:sources.has(repo.knowledgeId ?? repo.id)};}),
    technicalSources:new Set(repos.filter(r=>r.knowledgeId && sources.has(r.knowledgeId)).map(r=>r.knowledgeId!)),
    changeSources:new Set([...snapshot.applied,...snapshot.recent].map(r => r.id).filter(id => sources.has(id))),pendingSources:new Set(snapshot.pending.map(r => r.id).filter(id => sources.has(id))),taskIds:new Set(snapshot.candidates.map(t => t.id).filter(id => sources.has(id))),
    text:JSON.stringify({today:bogotaDay(),timezone:"America/Bogota",scope:project.id,memory:{status:memory.status,warning:memory.warning,supersededGithubHitsOmitted:memory.hits.filter(h=>h.projectId===project.id).length-scopedMemory.length},sourceCoverage:memory.coverage?{total:memory.coverage.total,pending:memory.coverage.pending,unavailable:memory.coverage.unavailable,excluded:memory.coverage.excluded}:undefined,github:{live:false,notTaskCompletion:true},omittedRecords:omitted,records:selected})};
}

export function validateProjectUpdate(value: unknown, context: ReturnType<typeof projectUpdateContext>): ProjectUpdateResult {
  const fail = (): never => {throw new CoreValidationError("La actualización no contiene evidencia válida. No se aplicó ningún cambio.",502);};
  const row = value as ProjectUpdateResult;
  const str = (text:unknown,max:number) => typeof text === "string" && text.trim().length > 0 && text.length <= max;
  const ids = (values:unknown,allowed:Set<string>) => Array.isArray(values) && values.length > 0 && values.length <= 8 && values.every(id => typeof id === "string" && allowed.has(id));
  const claims = (values:unknown,allowed:Set<string>) => Array.isArray(values) && values.length <= 6 && values.every(c => c && str(c.text,900) && ids(c.sourceIds,allowed));
  if (!row || !str(row.summary,2000) || !ids(row.summarySourceIds,context.sources) || !claims(row.changes,context.changeSources) || !claims(row.pending,context.pendingSources) || !claims(row.risks,context.sources)) return fail();
  if (row.technicalActivity !== undefined && !claims(row.technicalActivity,context.technicalSources)) return fail();
  if (!row.nextAction || !str(row.nextAction.title,180) || !str(row.nextAction.reason,1000) || !ids(row.nextAction.sourceIds,context.sources)) return fail();
  if (row.nextAction.taskId !== null && (!context.taskIds.has(row.nextAction.taskId) || !row.nextAction.sourceIds.includes(row.nextAction.taskId))) return fail();
  return row;
}

export function buildProjectUpdatePlan(state: Workspace, userId: string, projectId: string, runId: string, summary: unknown, nextStep: unknown, now = new Date().toISOString()) {
  if (![summary,nextStep].every(value => typeof value === "string" && value.trim() && value.length <= 2000)) throw new CoreValidationError("Revisa el resumen y el próximo paso (hasta 2.000 caracteres cada uno).");
  const project=state.projects.find(p => p.id === projectId && p.userId === userId);
  if (!project) throw new CoreValidationError("Proyecto no encontrado.",404);
  const plan=buildCoreCommand(state,userId,"update_project",{id:projectId,updatedAt:project.updatedAt,currentSummary:summary,nextStepSummary:nextStep},`project-update-${runId}`,now);
  const event=plan.changes.find(c => c.table === "project_events")!;
  event.row.source_type="openai";event.row.source_id=runId;event.row.title="Resumen y siguiente acción confirmados";
  return plan;
}
