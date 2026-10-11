import type { Workspace, Task } from "./workspace-types";

export type Person = { id: string; name: string; email: string; role: string; isSelf: boolean; active: boolean };
export type TaskDetail = { primaryId: string | null; collaboratorIds: string[]; plannedStart: string | null; plannedEnd: string | null; columnId: string | null };
export type BoardColumn = { id: string; name: string; status: string };
export type Installment = { id: string; name: string; basisPoints: number; dueDate: string | null; milestoneId: string | null };
export type Period = { id: string; key: string; label: string; startDate: string; totalValue: number; installments: (Installment & { amount: number })[] };
export type AgreementRevision = { number: number; date: string; reason: string; totalValue: number; installments: Installment[]; mode: Agreement["mode"]; startDate: string; intervalMonths: number; title: string };
export type Agreement = { id: string; direction: "income" | "expense"; title: string; personId: string | null; currency: string; mode: "fixed" | "finite" | "periodic"; totalValue: number; startDate: string; intervalMonths: number; installments: Installment[]; periods: Period[]; revisions: AgreementRevision[]; legacy: boolean };
export type Movement = { id: string; agreementId: string; periodId: string; installmentId: string; amount: number; date: string; reference: string; opening: boolean };
export type TaskComment = { id: string; taskId: string; personId: string | null; body: string; createdAt: string };
export type Delivery = { id: string; taskId: string; personId: string | null; name: string; key: string; size: number; mime: string; createdAt: string };
export type ProjectSchedule = { plannedStart: string | null; actualStart: string | null };
export type ProjectOperations = { version: 1; revision: number; schedule?: ProjectSchedule; people: Person[]; taskDetails: Record<string, TaskDetail>; columns: BoardColumn[]; budgets: { currency: string; amount: number }[]; agreements: Agreement[]; movements: Movement[]; comments: TaskComment[]; deliveries: Delivery[] };
export type OperationsRecord = { id: string; userId: string; projectId: string; data: string; updatedAt: string };

export const STATE_LABELS: Record<string, string> = { inbox: "Inbox", pending: "Pendiente", ready: "Lista", in_progress: "En curso", blocked: "Bloqueada", review: "En revisión", completed: "Completada", cancelled: "Cancelada" };
export const defaultColumns = (): BoardColumn[] => ["pending", "in_progress", "blocked", "review", "completed"].map(status => ({ id: status, name: STATE_LABELS[status], status }));
export function emptyOperations(): ProjectOperations {
  return { version: 1, revision: 0, people: [], taskDetails: {}, columns: defaultColumns(), budgets: [], agreements: [], movements: [], comments: [], deliveries: [] };
}
export function operationsRecord(state: Workspace, projectId: string) { return state.operations?.find(row => row.projectId === projectId); }
export function operationsFor(state: Workspace, projectId: string): ProjectOperations {
  const row = operationsRecord(state, projectId);
  if (!row) return emptyOperations();
  const data = JSON.parse(row.data) as ProjectOperations;
  if (data.version !== 1 || !Array.isArray(data.people) || !Array.isArray(data.agreements)) throw new Error("Los datos del proyecto no tienen un formato compatible.");
  data.revision ??= 0;
  return data;
}
export function detailFor(operations: ProjectOperations, taskId: string): TaskDetail {
  return operations.taskDetails[taskId] ?? { primaryId: null, collaboratorIds: [], plannedStart: null, plannedEnd: null, columnId: null };
}
export function personHasTask(operations: ProjectOperations, taskId: string, personId: string) {
  const detail = detailFor(operations, taskId);
  return detail.primaryId === personId || detail.collaboratorIds.includes(personId);
}
export function isMyTask(state: Workspace, task: Task) {
  const data = operationsFor(state, task.projectId), detail = detailFor(data, task.id);
  // Preserve existing, unassigned tasks in the personal plan.
  return !detail.primaryId && !detail.collaboratorIds.length || data.people.some(person => person.active && person.isSelf && personHasTask(data, task.id, person.id));
}
export function filterTaskPerson(state: Workspace, task: Task, person: string) {
  if (person === "all") return true;
  if (person === "mine") return isMyTask(state, task);
  const data = operationsFor(state, task.projectId);
  if (person === "unassigned") { const detail = detailFor(data, task.id); return !detail.primaryId && !detail.collaboratorIds.length; }
  return personHasTask(data, task.id, person);
}
export function installmentAmounts(total: number, installments: Installment[]) {
  // Integer basis points and BigInt prevent floating point drift and overflow.
  const floors = installments.map(item => Number(BigInt(total) * BigInt(item.basisPoints) / BigInt(10000)));
  const fractions = installments.map((item, index) => ({ index, remainder: BigInt(total) * BigInt(item.basisPoints) % BigInt(10000) })).sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  for (let index = 0, remaining = total - floors.reduce((sum, amount) => sum + amount, 0); index < remaining; index++) floors[fractions[index].index]++;
  return installments.map((item, index) => ({ ...item, amount: floors[index] }));
}
export function installmentPaid(data: ProjectOperations, agreementId: string, periodId: string, installmentId: string) {
  return data.movements.filter(row => row.agreementId === agreementId && row.periodId === periodId && row.installmentId === installmentId).reduce((sum, row) => sum + row.amount, 0);
}
export function agreementTotals(data: ProjectOperations, agreement: Agreement) {
  const total = agreement.periods.reduce((sum, period) => sum + period.totalValue, 0);
  const paid = data.movements.filter(row => row.agreementId === agreement.id).reduce((sum, row) => sum + row.amount, 0);
  return { total, paid, pending: total - paid };
}
export function financeTotals(state: Workspace, projectId: string) {
  const data = operationsFor(state, projectId), result = new Map<string, { currency: string; income: number; received: number; expenses: number; paid: number; budget: number | null }>();
  const get = (currency: string) => { if (!result.has(currency)) result.set(currency, { currency, income: 0, received: 0, expenses: 0, paid: 0, budget: data.budgets.find(b => b.currency === currency)?.amount ?? null }); return result.get(currency)!; };
  data.budgets.forEach(b => get(b.currency));
  for (const agreement of data.agreements) { const totals = agreementTotals(data, agreement), row = get(agreement.currency); if (agreement.direction === "income") { row.income += totals.total; row.received += totals.paid; } else { row.expenses += totals.total; row.paid += totals.paid; } }
  const legacy = state.financials.find(row => row.projectId === projectId);
  if (legacy && !data.agreements.some(a => a.legacy)) { const row = get(legacy.currency); row.income += legacy.totalValue; row.received += legacy.amountPaid; }
  return [...result.values()];
}
export function addMonths(day: string, months: number) {
  const [year, month, date] = day.split("-").map(Number), target = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date, last));
  return target.toISOString().slice(0, 10);
}
export function nextPeriodDate(agreement: Agreement) { return addMonths(agreement.startDate, agreement.periods.length * agreement.intervalMonths); }
export function assignmentLabel(data: ProjectOperations, taskId: string) {
  const detail = detailFor(data, taskId);
  const primary = data.people.find(p => p.id === detail.primaryId)?.name;
  const collaborators = detail.collaboratorIds.map(id => data.people.find(p => p.id === id)?.name).filter(Boolean);
  return [primary ? `Responsable: ${primary}` : "Sin responsable principal", collaborators.length ? `Colaboradores: ${collaborators.join(", ")}` : ""].filter(Boolean).join(" · ");
}
