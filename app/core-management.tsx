"use client";

import { useState } from "react";
import { Pencil, Plus, CircleDollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PROJECT_STATUSES, PROJECT_TYPES, COMMERCIAL_STATUSES, TASK_STATUSES, MILESTONE_STATUSES } from "@/lib/core-commands";
import type { Workspace } from "@/lib/workspace-types";
import { taskMeeting } from "@/lib/task-timing";
import { MeetingOriginField } from "./task-timing";
import { operationsFor, operationsRecord, detailFor } from "@/lib/project-operations";

export type SaveCore = (action: string, payload: Record<string, unknown>, commandId?: string) => Promise<string | null>;
type Kind = "project" | "task" | "milestone" | "financial" | "payment";
type Row = Record<string, unknown>;
const labels: Record<string, string> = { inbox: "Inbox", pending: "Pendiente", ready: "Lista", in_progress: "En curso", blocked: "Bloqueada", review: "En revisión", completed: "Completada", cancelled: "Cancelada" };
const money = (amount: number, currency: string) => new Intl.NumberFormat("es-CO", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

function Choice({ label, value, options, set }: { label: string; value: string; options: { value: string; label: string }[]; set: (value: string) => void }) {
  return <label><span>{label}</span><Select value={value || "_none"} onValueChange={(next) => set(next ?? "_none")}><SelectTrigger aria-label={label}><SelectValue /></SelectTrigger><SelectContent>{options.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></label>;
}

export function CoreButton({ kind, state, save, row, projectId, title, saved }: { kind: Kind; state: Workspace; save: SaveCore; row?: Row; projectId?: string; title?: string; saved?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [dependencies, setDependencies] = useState<string[]>([]);
  const [collaborators, setCollaborators] = useState<string[]>([]);
  const [operationsVersion, setOperationsVersion] = useState<string | null>(null);
  const [commandId, setCommandId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const edit = Boolean(row);
  const heading = kind === "project" ? edit ? "Editar proyecto" : "Nuevo proyecto" : kind === "task" ? edit ? "Editar tarea" : "Nueva tarea" : kind === "milestone" ? edit ? "Editar hito" : "Nuevo hito" : kind === "financial" ? "Condiciones de pago" : "Registrar pago";
  const launch = () => {
    const taskProject = String(row?.projectId ?? projectId ?? state.projects[0]?.id ?? "");
    const taskDetail = detailFor(operationsFor(state, taskProject), String(row?.id ?? ""));
    setCollaborators(taskDetail.collaboratorIds);
    const scheduleProject = kind === "project" ? String(row?.id ?? "") : taskProject;
    const schedule = operationsFor(state, scheduleProject).schedule;
    setOperationsVersion(operationsRecord(state, scheduleProject)?.updatedAt ?? null);
    const originMeetingId = kind === "task" && row ? row.originMeetingId || taskMeeting(state, row as Workspace["tasks"][number])?.item.id || "" : "";
    setValues(Object.fromEntries(Object.entries({ projectId: projectId ?? state.projects[0]?.id ?? "", shortCode: "", projectType: "Por alcance", operationalStatus: "Por iniciar", commercialStatus: "Sin definir", priority: 3, strategicPriority: 3, urgency: 3, estimatedMinutes: 30, position: state.milestones.filter((item) => item.projectId === projectId).length + 1, status: "pending", currency: "COP", totalValue: 0, paymentDate: today(), ...row, ...(kind === "task" ? { originMeetingId, primaryId: taskDetail.primaryId ?? "_none", plannedStart: taskDetail.plannedStart, plannedEnd: taskDetail.plannedEnd } : {}) }).map(([key, value]) => [key, value == null ? "" : String(value)])));
    setDependencies(state.dependencies.filter((edge) => edge.taskId === row?.id).map((edge) => edge.dependsOnTaskId));
    if (kind === "project") setValues(current => ({ ...current, projectPlannedStart: schedule?.plannedStart ?? "", projectActualStart: schedule?.actualStart ?? "" }));
    setCommandId(crypto.randomUUID()); setError(""); setOpen(true);
  };
  const set = (key: string, value: string) => setValues((current) => ({ ...current, [key]: value }));
  const input = (key: string, label: string, type = "text", required = false, maxLength?: number) => <label><span>{label}</span><Input name={key} aria-label={label} type={type} value={values[key] ?? ""} onChange={(event) => set(key, event.target.value)} onInput={type === "date" ? event => set(key, event.currentTarget.value) : undefined} required={required} maxLength={maxLength} min={type === "number" ? kind === "payment" ? 1 : 0 : undefined} step={type === "number" ? 1 : undefined} /></label>;
  const area = (key: string, label: string) => <label><span>{label}</span><Textarea name={key} aria-label={label} value={values[key] ?? ""} maxLength={2000} onChange={(event) => set(key, event.target.value)} /></label>;
  const choice = (key: string, label: string, options: string[]) => <Choice label={label} value={values[key] ?? ""} set={(value) => set(key, value)} options={options.map((value) => ({ value, label: labels[value] ?? value }))} />;
  const rating = (key: string, label: string) => choice(key, label, ["1", "2", "3", "4", "5"]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (saving) return;
    setSaving(true); setError("");
    let action = ""; let payload: Row = {};
    if (kind === "project") { action = edit ? "update_project" : "create_project"; payload = { ...values, operationsUpdatedAt: operationsVersion, ...(edit ? { id: row!.id } : {}) }; }
    if (kind === "task") { action = edit ? "update_task" : "create_task"; payload = { ...values, ...(edit ? { id: row!.id } : {}), milestoneId: values.milestoneId === "_none" ? "" : values.milestoneId ?? "", primaryId: values.primaryId === "_none" ? "" : values.primaryId ?? "", collaboratorIds: collaborators, operationsUpdatedAt: operationsVersion, dependsOnTaskIds: dependencies }; }
    if (kind === "milestone") { action = edit ? "update_milestone" : "create_milestone"; payload = { ...values, ...(edit ? { id: row!.id } : {}) }; }
    if (kind === "financial") { action = "update_financials"; payload = { projectId, totalValue: values.totalValue, currency: values.currency, paymentStructure: values.paymentStructure, notes: values.notes }; }
    if (kind === "payment") { action = "record_payment"; payload = { projectId, amount: values.amount, paymentDate: values.paymentDate, reference: values.reference }; }
    try { const id = await save(action, payload, commandId); setOpen(false); if (id && saved) saved(id); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "No se guardó el cambio. Intenta nuevamente."); }
    finally { setSaving(false); }
  };
  const projectTasks = state.tasks.filter((task) => task.projectId === values.projectId && task.id !== row?.id);
  return <><Button type="button" size="sm" variant={edit || kind === "financial" ? "outline" : "default"} onClick={launch}>{kind === "payment" ? <CircleDollarSign size={15} /> : edit ? <Pencil size={15} /> : <Plus size={15} />}{title ?? heading}</Button><Dialog open={open} onOpenChange={(next) => { if (!saving) setOpen(next); }}><DialogContent className="core-dialog" showCloseButton={!saving}><DialogHeader><DialogTitle>{heading}</DialogTitle><DialogDescription>{kind === "payment" ? "Registra dinero recibido. Esto no realiza ninguna transferencia." : "Los cambios se guardan junto con su registro en el historial."}</DialogDescription></DialogHeader><form onSubmit={submit}><div className="core-form">
    {kind === "project" && <>
      <div className="core-form-row">{input("name", "Nombre del proyecto", "text", true, 180)}{input("shortCode", "Código corto", "text", false, 8)}</div>
      {area("description", "Objetivo y alcance")}
      <div className="core-form-row">{choice("projectType", "Tipo de proyecto", PROJECT_TYPES)}{choice("operationalStatus", "Estado operativo", PROJECT_STATUSES)}</div>
      <div className="core-form-row">{choice("commercialStatus", "Estado comercial", COMMERCIAL_STATUSES)}{input("targetEndDate", "Fecha objetivo", "date")}</div>
      <div className="core-form-row">{input("projectPlannedStart", "Inicio planificado del proyecto", "date")}{input("projectActualStart", "Inicio real del proyecto", "date")}</div>
      <p className="core-hint">El tiempo transcurrido usa el inicio real cuando está definido; mientras tanto, usa el planificado. Las fechas vacías se muestran como «Sin definir».</p>
      <div className="core-form-row">{rating("priority", "Prioridad (1–5)")}{rating("strategicPriority", "Prioridad estratégica (1–5)")}</div>
      {area("currentSummary", "Estado actual")}{area("nextStepSummary", "Siguiente acción")}{input("blockedReason", "Bloqueador del proyecto")}
    </>}
    {kind === "task" && <>
      {!edit && <Choice label="Proyecto" value={values.projectId} options={state.projects.map((item) => ({ value: item.id, label: item.name }))} set={(value) => { set("projectId", value); set("milestoneId", "_none"); set("originMeetingId", ""); set("primaryId", "_none"); setDependencies([]); setCollaborators([]); setOperationsVersion(operationsRecord(state, value)?.updatedAt ?? null); }} />}
      {input("title", "Título de la tarea", "text", true, 180)}{area("description", "Descripción y criterios de aceptación")}
      <div className="core-form-row">{choice("status", "Estado de la tarea", TASK_STATUSES)}<Choice label="Hito" value={values.milestoneId} options={[{ value: "_none", label: "Sin hito" }, ...state.milestones.filter((item) => item.projectId === values.projectId).map((item) => ({ value: item.id, label: item.name }))]} set={(value) => set("milestoneId", value)} /></div>
      <div className="core-form-row">{rating("priority", "Prioridad de tarea (1–5)")}{rating("urgency", "Urgencia (1–5)")}</div>
      <Choice label="Responsable principal" value={values.primaryId} options={[{ value: "_none", label: "Sin asignar" }, ...operationsFor(state, values.projectId).people.filter(p => p.active).map(p => ({ value: p.id, label: p.isSelf ? `${p.name} · Tú` : p.name }))]} set={value => { set("primaryId", value); setCollaborators(current => current.filter(id => id !== value)); }} />
      <fieldset className="core-dependencies"><legend>Colaboradores</legend>{operationsFor(state, values.projectId).people.filter(p => p.active && p.id !== values.primaryId).map(p => <label key={p.id}><Checkbox aria-label={`Colaborador ${p.name}`} checked={collaborators.includes(p.id)} onCheckedChange={checked => setCollaborators(current => checked ? [...current, p.id] : current.filter(id => id !== p.id))} /><span>{p.name}</span></label>)}{!operationsFor(state, values.projectId).people.length && <p>Añade personas desde Tareas → Personas del proyecto.</p>}</fieldset>
      <div className="core-form-row">{input("plannedStart", "Inicio planificado (Gantt)", "date")}{input("plannedEnd", "Fin planificado (Gantt)", "date")}</div>
      <MeetingOriginField state={state} userId={state.projects.find(item => item.id === values.projectId)?.userId ?? ""} projectId={values.projectId} originalId={edit ? String(row?.originMeetingId || taskMeeting(state, row as Workspace["tasks"][number])?.item.id || "") : null} value={values.originMeetingId ?? ""} change={value => set("originMeetingId", value)} />
      <div className="core-form-row">{input("tentativeDeliveryDate", "Entrega tentativa (opcional)", "date")}{input("estimatedMinutes", "Duración estimada (minutos)", "number", true)}</div>
      {values.tentativeDeliveryDate && <Button type="button" variant="ghost" size="sm" onClick={() => set("tentativeDeliveryDate", "")}>Quitar entrega tentativa</Button>}
      <p className="core-hint">La entrega tentativa es orientativa: no marca la tarea como vencida ni cambia su prioridad.</p>
      {input("deadline", "Fecha límite confirmada (opcional)", "date")}
      <p className="core-hint">La fecha límite confirmada sí genera alertas de vencimiento. Las fechas límite existentes se conservan.</p>
      {values.status === "blocked" && input("blockingReason", "Motivo del bloqueo")}
      <fieldset className="core-dependencies"><legend>Debe completarse después de</legend>{projectTasks.length ? projectTasks.map((task) => <label key={task.id}><Checkbox aria-label={`Depende de ${task.title}`} checked={dependencies.includes(task.id)} onCheckedChange={(checked) => setDependencies((current) => checked ? [...current, task.id] : current.filter((id) => id !== task.id))} /><span>{task.title}<small>{labels[task.status] ?? task.status}</small></span></label>) : <p>No hay otras tareas en este proyecto.</p>}</fieldset>
    </>}
    {kind === "milestone" && <>{input("name", "Nombre del hito", "text", true, 180)}{area("description", "Resultado esperado")}<div className="core-form-row">{choice("status", "Estado del hito", MILESTONE_STATUSES)}{input("targetDate", "Fecha del hito", "date")}</div>{input("position", "Orden del hito", "number")}</>}
    {kind === "financial" && <><div className="core-form-row">{input("totalValue", "Valor total (unidades enteras)", "number", true)}{input("currency", "Moneda (COP, USD, EUR…)", "text", true, 3)}</div>{area("paymentStructure", "Condiciones de pago")}{area("notes", "Notas financieras")}<p className="core-hint">El saldo se calcula a partir de los pagos registrados. No se modifica el dinero recibido desde este formulario.</p></>}
    {kind === "payment" && <><div className="core-form-row">{input("amount", "Monto recibido (unidades enteras)", "number", true)}{input("paymentDate", "Fecha del pago", "date", true)}</div>{input("reference", "Referencia o comprobante", "text", false, 500)}<p className="core-hint">El pago y el nuevo saldo quedan registrados juntos en el historial.</p></>}
  </div>{error && <p className="core-error" role="alert">{error}</p>}<DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={() => setOpen(false)}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? "Guardando…" : kind === "payment" ? "Registrar pago" : "Guardar cambios"}</Button></DialogFooter></form></DialogContent></Dialog></>;
}

export function MilestonesPanel({ state, projectId, save }: { state: Workspace; projectId: string; save: SaveCore }) {
  const milestones = state.milestones.filter((item) => item.projectId === projectId);
  return <section className="panel core-panel"><div className="section-heading"><div><p>ENTREGABLES</p><h2>Hitos del proyecto</h2></div><CoreButton kind="milestone" state={state} projectId={projectId} save={save} /></div>{milestones.length ? milestones.map((item) => {
    const tasks = state.tasks.filter((task) => task.milestoneId === item.id);
    return <article className="core-milestone" key={item.id}><span className="core-order">{item.position}</span><div><h3>{item.name}</h3><p>{item.description}</p><small>{labels[item.status]} · {tasks.filter((task) => task.status === "completed").length}/{tasks.length} tareas completadas{item.targetDate ? ` · Fecha: ${item.targetDate}` : ""}</small></div><CoreButton kind="milestone" row={item} state={state} projectId={projectId} save={save} title="Editar hito" /></article>;
  }) : <p className="core-empty">Define el primer entregable y después vincula sus tareas.</p>}</section>;
}

export function PaymentsPanel({ state, projectId, save }: { state: Workspace; projectId: string; save: SaveCore }) {
  const financial = state.financials.find((item) => item.projectId === projectId);
  const receipts = state.events.filter((item) => item.projectId === projectId && item.eventType === "payment");
  return <section className="panel core-panel"><div className="section-heading"><div><p>VALOR Y PAGOS</p><h2>Resumen financiero</h2></div><CoreButton kind="financial" state={state} row={financial} projectId={projectId} save={save} title={financial ? "Editar condiciones" : "Definir valor"} /></div>{financial ? <><div className="core-financial-grid"><div><small>Valor total</small><strong>{money(financial.totalValue, financial.currency)}</strong></div><div><small>Recibido</small><strong>{money(financial.amountPaid, financial.currency)}</strong></div><div><small>Pendiente</small><strong>{money(financial.amountPending, financial.currency)}</strong></div></div><p>{financial.paymentStructure}</p>{financial.notes && <p className="core-hint">{financial.notes}</p>}{financial.amountPending > 0 && <CoreButton kind="payment" state={state} projectId={projectId} save={save} />}<div className="core-receipts"><h3>Pagos registrados</h3>{receipts.length ? receipts.map((event) => <article key={event.id}><time>{new Date(event.eventDate).toLocaleDateString("es-CO", { timeZone: "America/Bogota" })}</time><p>{event.description}</p></article>) : <p className="core-hint">Sin movimientos registrados en este historial. El saldo existente se conserva.</p>}</div></> : <p className="core-empty">Define el valor del proyecto antes de registrar un pago.</p>}</section>;
}
