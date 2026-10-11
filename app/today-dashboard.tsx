"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, Check, ChevronDown, Clock3, ListTodo, Play, Target, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CoreButton, type SaveCore } from "./core-management";
import { PersonFilter } from "./project-team";
import { STATE_LABELS } from "@/lib/project-operations";
import { bogotaDay, rankTask } from "@/lib/daily-engine";
import { displayCalendarDate } from "@/lib/task-timing";
import { dashboardTasks, deadlineSignal, daysBetween, matchesMetric, projectProgress, projectScope, recommendedTasks, sortAgenda, taskCounts, type TaskMetric } from "@/lib/today-dashboard";
import type { Workspace, Task, Project } from "@/lib/workspace-types";

const metricLabels = { total: "Total de tareas", pending: "Pendientes", completed: "Completadas" };
const dateLabel = (date: string | null) => date ? displayCalendarDate(date) : "Sin definir";
const remainingLabel = (days: number | null) => days === null ? "Finalización sin definir" : days < 0 ? `${-days} ${days === -1 ? "día" : "días"} de atraso` : days === 0 ? "Finaliza hoy" : `${days} ${days === 1 ? "día restante" : "días restantes"}`;
const projectById = (state: Workspace, id: string) => state.projects.find(p => p.id === id);

function TaskActions({ task, state, save }: { task: Task; state: Workspace; save: SaveCore }) {
  const [busy, setBusy] = useState(false);
  const blocked = task.isBlocked || state.dependencies.some(edge => edge.taskId === task.id && state.tasks.find(t => t.id === edge.dependsOnTaskId)?.status !== "completed");
  const closed = ["completed", "cancelled"].includes(task.status);
  const change = async (status: string) => {
    if (busy) return; setBusy(true);
    try { await save("update_task_status", { id: task.id, status, updatedAt: task.updatedAt }, crypto.randomUUID()); }
    catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo actualizar la tarea."); }
    finally { setBusy(false); }
  };
  return <div className="today-task-actions" aria-busy={busy}>
    {!closed && task.status !== "in_progress" && <Button size="sm" variant="outline" disabled={busy || blocked || !task.approved || task.status === "inbox"} title={blocked ? "Completa las dependencias o resuelve el bloqueo" : "Iniciar tarea"} onClick={() => void change("in_progress")}><Play size={14} /><span>Iniciar</span></Button>}
    {!closed && <Button size="sm" variant="outline" disabled={busy || blocked} onClick={() => void change("completed")}><Check size={14} /><span>Completar</span></Button>}
    {!busy && <CoreButton kind="task" state={state} row={task} save={save} title="Editar" />}
  </div>;
}

function ProjectBars({ state, project, today }: { state: Workspace; project: Project; today: string }) {
  const p = projectProgress(state, project, today);
  return <div className="today-project-bars">
    <div className="today-bar-label"><strong>Avance de tareas</strong><b>{p.completedPercent}%</b></div>
    <div className="today-progress-track" role="img" aria-label={`${p.completed} completadas, ${p.cancelled} canceladas y ${p.pending} pendientes`}>
      <span className="today-progress-done" style={{ width: `${p.completedSegment}%` }} /><span className="today-progress-cancelled" style={{ width: `${p.cancelledSegment}%` }} />
    </div>
    <div className="today-bar-legend"><span><i className="done" />{p.completed} completadas</span><span><i className="cancelled" />{p.cancelled} canceladas</span><span>{p.pending} pendientes</span></div>
    <div className="today-bar-label"><strong>Tiempo transcurrido</strong><b>{p.timePercent === null ? "Sin definir" : `${p.timePercent}%`}</b></div>
    <div className={`today-progress-track time ${p.remaining !== null && p.remaining < 0 ? "overdue" : ""}`} role="img" aria-label={p.timePercent === null ? "Faltan fechas para calcular el tiempo" : `${p.timePercent}% del plazo transcurrido`}><span style={{ width: `${p.timePercent ?? 0}%` }} /></div>
    <small>{p.timePercent === null ? "Define un inicio y una fecha de finalización." : `${p.startBasis}: ${dateLabel(p.start)} · ${remainingLabel(p.remaining)}`}</small>
  </div>;
}

function ProjectTimeline({ state, projects, today, select }: { state: Workspace; projects: Project[]; today: string; select: (id: string) => void }) {
  const rows = projects.map(project => ({ project, progress: projectProgress(state, project, today) }));
  const dated = rows.filter(({ progress: p }) => p.start && p.end);
  const dates = [today, ...dated.flatMap(({ progress: p }) => [p.start!, p.end!, ...(p.plannedStart ? [p.plannedStart] : [])])].sort();
  const from = dates[0], to = dates[dates.length - 1];
  const span = Math.max(daysBetween(from, to), 1);
  const position = (date: string) => Math.max(0, Math.min(100, daysBetween(from, date) / span * 100));
  return <section className="panel today-timeline" aria-labelledby="today-timeline-title">
    <div className="today-section-heading"><div><p className="eyebrow">FECHAS DEL PORTAFOLIO</p><h2 id="today-timeline-title">Línea de tiempo</h2><p>Compara el plazo de los proyectos. La línea vertical indica hoy.</p></div><span className="today-chip">Hoy · {dateLabel(today)}</span></div>
    {!!dated.length && <><div className="today-timeline-scale"><span>{dateLabel(from)}</span><span>{dateLabel(to)}</span></div>
      <div className="today-timeline-rows">{dated.map(({ project, progress: p }) => {
        const start = p.start!, end = p.end!, left = position(start), right = position(end), late = start > end;
        return <div className="today-timeline-row" key={project.id}><button className="today-timeline-name" onClick={() => select(project.id)}><strong>{project.name}</strong><small>{p.startBasis} · {dateLabel(start)} → {dateLabel(end)}</small></button><div className="today-timeline-track" role="img" aria-label={`${project.name}. ${p.startBasis}: ${dateLabel(start)}. Finalización: ${dateLabel(end)}. ${remainingLabel(p.remaining)}${late ? ". Inicio real posterior a la fecha objetivo" : ""}`}>
          <span className={`today-timeline-bar ${p.remaining !== null && p.remaining < 0 ? "overdue" : ""}`} style={{ left: `${Math.min(left, right)}%`, width: `${Math.max(1, Math.abs(right - left))}%` }}><span style={{ width: `${p.timePercent ?? 0}%` }} /></span>
          <i className="today-timeline-marker" style={{ left: `${position(today)}%` }} />
          {p.actualStart && p.plannedStart && p.actualStart !== p.plannedStart && <i className="today-planned-marker" title={`Inicio planificado: ${dateLabel(p.plannedStart)}`} style={{ left: `${position(p.plannedStart)}%` }} />}
        </div><span className={`today-timeline-remaining ${p.remaining !== null && p.remaining < 0 ? "is-overdue" : ""}`}>{late ? "Inicio posterior al plazo · " : ""}{remainingLabel(p.remaining)}</span></div>;
      })}</div></>}
    {rows.some(({ progress: p }) => !p.start || !p.end) && <div className="today-undated-projects"><strong>Fechas por definir</strong>{rows.filter(({ progress: p }) => !p.start || !p.end).map(({ project, progress: p }) => <button key={project.id} onClick={() => select(project.id)}>{project.name}<small>{!p.start ? "Sin inicio" : ""}{!p.start && !p.end ? " · " : ""}{!p.end ? "Sin finalización" : ""}<ArrowRight size={14} /></small></button>)}</div>}
    {!rows.length && <p className="today-empty">No hay proyectos para los filtros seleccionados.</p>}
  </section>;
}

export function TodayDashboard({ state, save, openProject }: { state: Workspace; save: SaveCore; openProject: (id: string) => void }) {
  const [person, setPerson] = useState("mine"), [projectId, setProjectId] = useState("all"), [includeOther, setIncludeOther] = useState(false);
  const [expanded, setExpanded] = useState<TaskMetric | null>(null), [metric, setMetric] = useState<TaskMetric>("pending");
  const [detailId, setDetailId] = useState<string | null>(null), [today, setToday] = useState(() => bogotaDay());
  useEffect(() => { const timer = setInterval(() => setToday(bogotaDay()), 60000); return () => clearInterval(timer); }, []);
  const projects = projectScope(state, includeOther);
  const selectedId = projects.some(p => p.id === projectId) ? projectId : "all";
  const visibleProjects = projects.filter(p => selectedId === "all" || p.id === selectedId);
  const tasks = dashboardTasks(state, visibleProjects, person), counts = taskCounts(tasks);
  const recommendations = recommendedTasks(state, tasks, today);
  const agenda = sortAgenda(tasks.filter(t => matchesMetric(t, metric)));
  const dated = agenda.filter(t => t.deadline), undated = agenda.filter(t => !t.deadline);
  const overdue = tasks.filter(t => deadlineSignal(t, today).kind === "overdue");
  const blocked = tasks.filter(t => matchesMetric(t, "pending") && t.isBlocked);
  const detail = state.tasks.find(t => t.id === detailId);
  const selectProject = (id: string) => { setProjectId(id); };
  const blocks = state.calendar.filter(b => b.status !== "cancelled" && bogotaDay(new Date(b.startsAt)) === today && (!b.projectId || visibleProjects.some(p => p.id === b.projectId)) && (!b.taskId || tasks.some(t => t.id === b.taskId)));
  const renderRow = (task: Task) => {
    const project = projectById(state, task.projectId), signal = deadlineSignal(task, today);
    return <tr key={task.id} className={signal.kind === "overdue" ? "today-row-overdue" : ""}>
      <td data-label="Tarea"><button className="today-task-title" onClick={() => setDetailId(task.id)}>{task.title}</button><span className={`today-status status-${task.status}`}>{STATE_LABELS[task.status] ?? task.status}</span>{task.isBlocked && <small className="today-blocked-reason"><AlertTriangle size={12} />{task.blockingReason || "Bloqueada"}</small>}</td>
      <td data-label="Proyecto"><button className="today-project-link" onClick={() => selectProject(task.projectId)}><span className="today-project-dot" />{project?.name ?? "Proyecto"}</button></td>
      <td data-label="Entrega"><strong>{task.deadline ? dateLabel(task.deadline) : "Sin fecha límite"}</strong>{task.tentativeDeliveryDate && <small>Tentativa: {dateLabel(task.tentativeDeliveryDate)}</small>}</td>
      <td data-label="Plazo"><span className={`today-deadline ${signal.kind}`}>{signal.label}</span></td>
      <td data-label="Prioridad"><span className="today-priority">{task.priority}/5</span><small><Clock3 size={12} />{task.estimatedMinutes} min</small></td>
      <td className="today-actions-cell"><TaskActions task={task} state={state} save={save} /></td>
    </tr>;
  };
  return <div className="view-stack today-dashboard">
    <section className="today-intro"><div><p className="eyebrow">{new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${today}T12:00:00Z`))}</p><h1>Tu panorama de hoy.</h1><p>Lo pendiente, las próximas entregas y el avance de tus proyectos.</p></div><span className="today-chip"><Target size={15} />{visibleProjects.length} proyectos</span></section>
    <div className="today-filters"><label>Proyectos<select aria-label="Filtrar por proyecto" value={selectedId} onChange={e => setProjectId(e.target.value)}><option value="all">Todos los proyectos</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><PersonFilter state={state} value={person} change={setPerson} /><label>Estado del proyecto<select aria-label="Filtrar estados de proyectos" value={includeOther ? "all" : "active"} onChange={e => { setIncludeOther(e.target.value === "all"); setProjectId("all"); }}><option value="active">Activos y por iniciar</option><option value="all">Todos los estados</option></select></label></div>
    <div className="today-kpis">{(["total", "pending", "completed"] as TaskMetric[]).map(key => <button key={key} className={`today-kpi ${key} ${expanded === key ? "selected" : ""}`} aria-expanded={expanded === key} aria-controls="today-project-breakdown" onClick={() => { setExpanded(expanded === key ? null : key); setMetric(key); }}><span>{metricLabels[key]}{key === "completed" ? <Check size={19} /> : key === "pending" ? <Clock3 size={19} /> : <ListTodo size={19} />}</span><strong>{counts[key]}</strong><small>Ver por proyecto <ChevronDown size={14} /></small></button>)}</div>
    <p className="today-scope-note">{person === "mine" ? "Mis tareas (incluye las que aún no tienen responsable)" : person === "all" ? "Tareas de todo el equipo" : "Tareas del responsable seleccionado"} · Todas las fechas · Las canceladas se excluyen de estos totales.</p>
    {expanded && <section id="today-project-breakdown" className="panel today-breakdown"><div className="today-section-heading"><div><h2>{metricLabels[expanded]} por proyecto</h2><p>Selecciona un proyecto para explorar sus tareas.</p></div><Button variant="ghost" size="icon" aria-label="Cerrar desglose" onClick={() => setExpanded(null)}><X size={17} /></Button></div><div className="today-breakdown-grid">{visibleProjects.map(p => { const count = taskCounts(tasks.filter(t => t.projectId === p.id))[expanded]; return <button key={p.id} onClick={() => selectProject(p.id)}><span><strong>{p.name}</strong><b>{count}</b></span><div className="today-progress-track"><span className="today-progress-done" style={{ width: `${counts[expanded] ? count / counts[expanded] * 100 : 0}%` }} /></div></button>; })}</div>{selectedId !== "all" && <Button size="sm" variant="outline" onClick={() => setProjectId("all")}>Ver todos los proyectos</Button>}{!visibleProjects.length && <p className="today-empty">No hay proyectos en esta selección.</p>}</section>}
    <section className="panel today-focus"><div className="today-section-heading"><div><p className="eyebrow">EN QUÉ ENFOCARTE</p><h2>Tus tres siguientes acciones</h2></div><span className="today-chip">Prioridad por reglas</span></div><div className="today-focus-grid">{recommendations.map((task, i) => <article key={task.id}><span className="today-focus-rank">0{i + 1}</span><div><small>{projectById(state, task.projectId)?.name}</small><button className="today-task-title" onClick={() => setDetailId(task.id)}>{task.title}</button><p>{rankTask(task, state, today).reason}</p><TaskActions task={task} state={state} save={save} /></div></article>)}</div>{!recommendations.length && <p className="today-empty">No hay tareas disponibles para iniciar con estos filtros. Revisa los bloqueos o crea una tarea.</p>}</section>
    <section className="panel today-agenda" aria-labelledby="today-agenda-title"><div className="today-section-heading"><div><p className="eyebrow">ENTREGAS Y PLAZOS</p><h2 id="today-agenda-title">Agenda de tareas</h2><p>Primero las vencidas, después hoy y las próximas entregas.</p></div><label className="today-agenda-filter">Mostrar<select aria-label="Filtrar estado de tareas" value={metric} onChange={e => setMetric(e.target.value as TaskMetric)}><option value="pending">Pendientes</option><option value="completed">Completadas</option><option value="total">Todas las tareas</option></select></label></div>
      <div className="today-agenda-signals"><span className={overdue.length ? "is-overdue" : ""}><AlertTriangle size={14} />{overdue.length} vencidas</span><span>{tasks.filter(t => deadlineSignal(t, today).kind === "today").length} vencen hoy</span><span>{blocked.length} bloqueadas</span><span>{agenda.length} en esta vista</span></div>
      {agenda.length ? <table className="today-task-table"><caption className="sr-only">Tareas ordenadas por fecha límite confirmada. Las tareas sin fecha están al final.</caption><thead><tr><th scope="col">Tarea / estado</th><th scope="col">Proyecto</th><th scope="col">Entrega</th><th scope="col">Plazo</th><th scope="col">Prioridad</th><th scope="col">Acciones</th></tr></thead><tbody>{dated.map(renderRow)}{!!undated.length && <tr className="today-undated-heading"><th colSpan={6} scope="colgroup">Sin fecha límite · {undated.length} tareas</th></tr>}{undated.map(renderRow)}</tbody></table> : <p className="today-empty">No hay tareas para esta selección.</p>}
    </section>
    <section aria-labelledby="today-projects-title"><div className="today-section-heading"><div><p className="eyebrow">AVANCE GLOBAL DE CADA PROYECTO</p><h2 id="today-projects-title">Proyectos en perspectiva</h2><p>Estas barras incluyen las tareas de todo el equipo. El porcentaje excluye las canceladas.</p></div></div><div className="today-project-grid">{visibleProjects.map(project => {
      const progress = projectProgress(state, project, today), next = recommendedTasks(state, dashboardTasks(state, [project], person), today)[0];
      return <article className="panel today-project-summary" key={project.id}><div className="today-project-summary-head"><button onClick={() => openProject(project.id)}><h3>{project.name}</h3><span>{project.operationalStatus}</span></button><CoreButton kind="project" state={state} row={project} save={save} title="Fechas" /></div><p className="today-project-description">{project.currentSummary || project.description || "Sin resumen registrado."}</p><ProjectBars state={state} project={project} today={today} /><dl className="today-project-dates"><div><dt>Inicio planificado</dt><dd>{dateLabel(progress.plannedStart)}</dd></div><div><dt>Inicio real</dt><dd>{dateLabel(progress.actualStart)}</dd></div><div><dt>Finalización objetivo</dt><dd>{dateLabel(progress.end)}</dd></div><div><dt>Plazo restante</dt><dd className={progress.remaining !== null && progress.remaining < 0 ? "is-overdue" : ""}>{remainingLabel(progress.remaining)}</dd></div></dl><div className="today-project-next"><small>PRÓXIMA TAREA · {person === "mine" ? "MIS TAREAS" : "SEGÚN RESPONSABLE"}</small>{next ? <button onClick={() => setDetailId(next.id)}>{next.title}<ArrowRight size={15} /></button> : <p>Sin próxima tarea ejecutable.</p>}</div><div className="today-project-signals">{progress.overdue > 0 && <span className="is-overdue"><AlertTriangle size={13} />{progress.overdue} tareas vencidas</span>}{project.blockedReason && <span><AlertTriangle size={13} />{project.blockedReason}</span>}</div></article>;
    })}</div>{!visibleProjects.length && <div className="panel today-empty">No hay proyectos en esta selección. Puedes consultar todos los estados.</div>}</section>
    <ProjectTimeline state={state} projects={visibleProjects} today={today} select={selectProject} />
    {blocked.length > 0 && <section className="panel today-blockers"><div className="today-section-heading"><div><p className="eyebrow">REQUIEREN ATENCIÓN</p><h2>Bloqueadores</h2></div></div>{blocked.map(task => <button key={task.id} onClick={() => setDetailId(task.id)}><AlertTriangle size={17} /><span><strong>{task.title}</strong><small>{projectById(state, task.projectId)?.name} · {task.blockingReason || "Bloqueada"}</small></span><ArrowRight size={15} /></button>)}</section>}
    <div className="today-bottom-grid"><section className="panel"><div className="today-section-heading"><div><p className="eyebrow">PLAN DEL DÍA</p><h2>Tiempo protegido</h2></div></div>{blocks.map(block => <div className="today-recent-row" key={block.id}><time>{new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", hour: "numeric", minute: "2-digit" }).format(new Date(block.startsAt))}</time><div><strong>{block.title}</strong><small>{projectById(state, block.projectId ?? "")?.name} · {block.status === "proposed" ? "Propuesto" : "Confirmado"}</small></div></div>)}{!blocks.length && <p className="today-empty">Sin bloques registrados para hoy.</p>}</section><section className="panel"><div className="today-section-heading"><div><p className="eyebrow">HISTORIAL</p><h2>Cambios recientes</h2></div></div>{state.events.filter(e => visibleProjects.some(p => p.id === e.projectId)).slice(0, 4).map(event => <div className="today-recent-row" key={event.id}><div><strong>{event.title}</strong><small>{projectById(state, event.projectId)?.name} · {event.description}</small></div><time>{dateLabel(bogotaDay(new Date(event.eventDate)))}</time></div>)}{!state.events.some(e => visibleProjects.some(p => p.id === e.projectId)) && <p className="today-empty">Tus cambios aparecerán aquí.</p>}</section></div>
    <Dialog open={!!detail} onOpenChange={open => { if (!open) setDetailId(null); }}><DialogContent className="core-dialog"><DialogHeader><DialogTitle>{detail?.title}</DialogTitle><DialogDescription>{detail && projectById(state, detail.projectId)?.name} · {detail && STATE_LABELS[detail.status]}</DialogDescription></DialogHeader>{detail && <div className="today-task-detail"><p>{detail.description || "Sin descripción registrada."}</p><dl><div><dt>Fecha límite confirmada</dt><dd>{dateLabel(detail.deadline)}</dd></div><div><dt>Entrega tentativa</dt><dd>{dateLabel(detail.tentativeDeliveryDate)}</dd></div><div><dt>Plazo</dt><dd>{deadlineSignal(detail, today).label}</dd></div><div><dt>Duración estimada</dt><dd>{detail.estimatedMinutes} min</dd></div></dl>{detail.isBlocked && <p className="is-overdue">{detail.blockingReason}</p>}<TaskActions task={detail} state={state} save={save} /><Button variant="outline" onClick={() => { setDetailId(null); openProject(detail.projectId); }}>Abrir proyecto <ArrowRight size={15} /></Button></div>}</DialogContent></Dialog>
  </div>;
}
