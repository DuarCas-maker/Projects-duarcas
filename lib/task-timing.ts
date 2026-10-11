import { readMeeting } from "./meetings";
import { bogotaDay } from "./daily-engine";
import type { Task, Workspace } from "./workspace-types";

export function calendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function displayCalendarDate(value: string) { return value.split("-").reverse().join("/"); }

export function projectMeetings(state: Workspace, userId: string, projectId: string) {
  return state.knowledge.filter(item => item.userId === userId && item.projectId === projectId).flatMap(item => {
    const meeting = readMeeting(item);
    return meeting && calendarDate(meeting.date) ? [{ item, meeting }] : [];
  }).sort((a, b) => b.meeting.date.localeCompare(a.meeting.date) || a.item.id.localeCompare(b.item.id));
}

// Resolve the actual source relation, never titles, upload timestamps, or the
// latest meeting that happens to mention the task. Legacy approved tasks retain
// their original suggestion link, so no guessed or destructive backfill is needed.
export function taskMeeting(state: Workspace, task: Task) {
  const meetings = projectMeetings(state, task.userId, task.projectId);
  if (task.originMeetingId) return meetings.find(entry => entry.item.id === task.originMeetingId) ?? null;
  if (task.sourceType === "meeting") return meetings.find(entry => entry.item.id === task.sourceId) ?? null;
  if (task.sourceType !== "suggestion") return null;
  const suggestion = state.suggestions.find(item => item.id === task.sourceId && item.userId === task.userId && item.projectId === task.projectId && item.status === "approved");
  if (!suggestion) return null;
  try {
    const payload = JSON.parse(suggestion.payload);
    if (payload.action !== "create_task" || typeof payload.meetingId !== "string") return null;
    return meetings.find(entry => entry.item.id === payload.meetingId && entry.meeting.fingerprint === payload.meetingFingerprint) ?? null;
  } catch { return null; }
}

export function taskTiming(state: Workspace, task: Task, now = new Date()) {
  const origin = taskMeeting(state, task);
  if (!origin) return { origin: null, days: null, label: "Sin reunión vinculada" };
  let end = now;
  if (task.status === "completed") {
    if (!task.completedAt || !Number.isFinite(Date.parse(task.completedAt))) return { origin, days: null, label: "Finalización sin fecha registrada" };
    end = new Date(task.completedAt);
  }
  const day = bogotaDay(end);
  const days = Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${origin.meeting.date}T12:00:00Z`)) / 86400000);
  const count = Math.abs(days), unit = count === 1 ? "día" : "días";
  const label = task.status === "completed"
    ? days < 0 ? "Finalización anterior a la reunión" : days === 0 ? "Completada el mismo día" : `Completada en ${days} ${unit}`
    : days < 0 ? `Reunión en ${count} ${unit}` : days === 0 ? "Reunión de hoy · 0 días" : `Hace ${days} ${unit}`;
  return { origin, days, label };
}
