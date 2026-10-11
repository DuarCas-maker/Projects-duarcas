"use client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { operationsFor, assignmentLabel } from "@/lib/project-operations";
import { commentAuthor } from "@/lib/shared-project";
import type { Workspace, Task } from "@/lib/workspace-types";
import type { SaveCore } from "./core-management";
export function TaskCollaboration({ state, task, save }: { state: Workspace; task: Task; save: SaveCore }) {
  const data = operationsFor(state, task.projectId), comments = data.comments.filter(c => c.taskId === task.id), deliveries = data.deliveries.filter(d => d.taskId === task.id);
  const [body, setBody] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const requestId = useRef(crypto.randomUUID());
  return <div className="task-collaboration"><small>{assignmentLabel(data, task.id)}</small><details><summary>Comentarios y entregables · {comments.length + deliveries.length}</summary>{comments.map(c => <article key={c.id}><strong>{commentAuthor(data.people, c)} · {c.createdAt.slice(0, 10)}</strong><p>{c.body}</p></article>)}{deliveries.map(d => <a key={d.id} href={`/api/project-deliveries?projectId=${encodeURIComponent(task.projectId)}&id=${encodeURIComponent(d.id)}`}>{d.name} · {(d.size / 1024).toFixed(0)} KB</a>)}<form onSubmit={async e => { e.preventDefault(); if (busy) return; setBusy(true); setError(""); try { await save("add_task_comment", { projectId: task.projectId, taskId: task.id, body }, requestId.current); setBody(""); requestId.current = crypto.randomUUID(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}><Textarea aria-label={`Comentario de ${task.title}`} placeholder="Añadir comentario…" maxLength={2000} required value={body} onChange={e => setBody(e.target.value)} /><Button size="sm" disabled={busy || !body.trim()}>{busy ? "Guardando…" : "Comentar"}</Button></form>{error && <p className="core-error" role="alert">{error}</p>}</details></div>;
}
