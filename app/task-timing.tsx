"use client";
import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { bogotaDay } from "@/lib/daily-engine";
import { calendarDate, displayCalendarDate, projectMeetings, taskTiming } from "@/lib/task-timing";
import type { Task, Workspace } from "@/lib/workspace-types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { readProjectContext } from "@/lib/meetings";

export function TaskTimingLine({ state, task }: { state: Workspace; task: Task }) {
  const [, setDay] = useState(bogotaDay);
  useEffect(() => {
    // Refresh open screens at the next Bogotá date, without fetching or writing
    // any task data. Completed tasks still use their persisted completedAt.
    const timer = window.setInterval(() => setDay(bogotaDay()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const timing = taskTiming(state, task);
  return <div className="task-timing">
    <span title={timing.origin?.item.title}><CalendarDays size={13} />{timing.origin ? <>Reunión: <time dateTime={timing.origin.meeting.date}>{displayCalendarDate(timing.origin.meeting.date)}</time> · {timing.label}</> : timing.label}</span>
    {task.tentativeDeliveryDate && <span className="task-tentative">Entrega tentativa: <time dateTime={task.tentativeDeliveryDate}>{displayCalendarDate(task.tentativeDeliveryDate)}</time> · no es un vencimiento</span>}
  </div>;
}

export function MeetingOriginField({ state, userId, projectId, originalId, value, change }: {
  state: Workspace; userId: string; projectId: string; originalId?: string | null; value: string; change: (value: string) => void;
}) {
  const meetings = projectMeetings(state, userId, projectId);
  const original = meetings.find(entry => entry.item.id === originalId);
  if (originalId) return <div className="core-hint">Reunión de origen: <strong>{original ? `${displayCalendarDate(original.meeting.date)} · ${original.item.title}` : "Reunión original no disponible"}</strong>. Se conserva la reunión en la que surgió la tarea.</div>;
  return <label><span>Reunión de origen (opcional)</span><Select value={value || "_none"} onValueChange={next => change(next === "_none" || !next ? "" : next)}><SelectTrigger aria-label="Reunión de origen (opcional)"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="_none">Sin reunión vinculada</SelectItem>{meetings.map(({ item, meeting }) => <SelectItem key={item.id} value={item.id}>{displayCalendarDate(meeting.date)} · {item.title}</SelectItem>)}</SelectContent></Select><small className="core-hint">El contador empieza en la fecha de esta reunión, no al subir el archivo.</small></label>;
}

export function ProposalTimingDetails({ state, suggestion }: { state: Workspace; suggestion: Workspace["suggestions"][number] }) {
  if (suggestion.suggestionType !== "new_task") return null;
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(suggestion.payload); } catch { return null; }
  const data = payload?.data as Record<string, unknown> | undefined;
  const origin = projectMeetings(state, suggestion.userId, suggestion.projectId ?? "").find(entry => entry.item.id === payload?.meetingId && entry.meeting.fingerprint === payload.meetingFingerprint);
  const context = state.knowledge.find(item => item.id === payload?.contextId && item.userId === suggestion.userId && item.projectId === suggestion.projectId && readProjectContext(item)?.fingerprint === payload.contextFingerprint);
  return <div className="task-timing">
    <span>{context ? `Documento de contexto: ${context.title}` : origin ? `Reunión de origen: ${displayCalendarDate(origin.meeting.date)} · ${origin.item.title}` : "Sin reunión vinculada"}</span>
    <span className="task-tentative">{calendarDate(data?.tentativeDeliveryDate) ? `Entrega tentativa: ${displayCalendarDate(data.tentativeDeliveryDate)} · no es un vencimiento` : "Sin entrega tentativa"}</span>
    {calendarDate(data?.deadline) && <span>Fecha límite confirmada: {displayCalendarDate(data.deadline)}</span>}
  </div>;
}
