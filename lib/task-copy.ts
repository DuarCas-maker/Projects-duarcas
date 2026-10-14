import { detailFor, operationsFor, STATE_LABELS } from "./project-operations";
import { taskChildren,isMergedTask } from "./task-structure";
import type { Workspace } from "./workspace-types";

const inline = (value: string) => value.replace(/\s+/g, " ").trim();
const dateLabel = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split("-").reverse().join("/") : value;

export function formatTasksForCopy(state: Workspace, projectId: string, selectedIds: Iterable<string>): string {
  const project = state.projects.find(row => row.id === projectId);
  if (!project) return "";
  const ids = new Set(selectedIds);
  for(const id of [...ids]) for(const child of taskChildren(state,id)) if(child.projectId===projectId)ids.add(child.id);
  const selected = state.tasks.filter(task => task.projectId === projectId && ids.has(task.id) && !isMergedTask(task));
  const tasks=selected.filter(t=>!t.parentTaskId||!ids.has(t.parentTaskId)).flatMap(t=>[t,...selected.filter(child=>child.parentTaskId===t.id)]);
  if (!tasks.length) return "";
  const data = operationsFor(state, projectId);
  const blocks = tasks.map((task, index) => {
    const detail = detailFor(data, task.id);
    const primary = data.people.find(person => person.id === detail.primaryId);
    const collaborators = detail.collaboratorIds.flatMap(id => {
      const person = data.people.find(row => row.id === id);
      return person ? [inline(person.name)] : [];
    });
    const lines = [`${index + 1}. ${task.parentTaskId?"↳ ":""}*${inline(task.title)}*`];
    if(task.parentTaskId) lines.push(`   • Tarea principal: ${inline(state.tasks.find(t=>t.id===task.parentTaskId)?.title??"Sin definir")}`);
    const description = task.description.replace(/\r\n?/g, "\n").trim();
    if (description) lines.push(`   ${description.split("\n").map(line => line.trim()).join("\n   ")}`);
    lines.push(`   • Estado: ${STATE_LABELS[task.status] ?? inline(task.status)}`);
    lines.push(`   • Responsable: ${primary ? inline(primary.name) : "Sin asignar"}`);
    if (collaborators.length) lines.push(`   • Colaboradores: ${collaborators.join(", ")}`);
    if (task.deadline) lines.push(`   • Fecha límite: ${dateLabel(task.deadline)}`);
    if (task.tentativeDeliveryDate) lines.push(`   • Entrega tentativa: ${dateLabel(task.tentativeDeliveryDate)}`);
    if (detail.plannedStart) lines.push(`   • Inicio previsto: ${dateLabel(detail.plannedStart)}`);
    if (detail.plannedEnd) lines.push(`   • Fin previsto: ${dateLabel(detail.plannedEnd)}`);
    if (task.isBlocked) lines.push(`   • Bloqueo: ${inline(task.blockingReason || "Sin motivo registrado")}`);
    return lines.join("\n");
  });
  return [`*Proyecto: ${inline(project.name)}*`, `${tasks.length} ${tasks.length === 1 ? "tarea seleccionada" : "tareas seleccionadas"}`, ...blocks].join("\n\n");
}

export async function copyTaskText(text: string): Promise<boolean> {
  if (!text) return false;
  // Keep the clipboard call within the user's tap, as required by mobile browsers.
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* Fall through to the older browser clipboard API. */ }
  const previous = document.activeElement;
  const selection = document.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;";
  document.body.appendChild(textarea);
  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch { return false; }
  finally {
    textarea.remove();
    if (previous instanceof HTMLElement) previous.focus({ preventScroll: true });
    selection?.removeAllRanges();
    ranges.forEach(range => selection?.addRange(range));
  }
}
