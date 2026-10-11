import { CoreValidationError, databaseRow, TASK_STATUSES, type CoreChange, type Row } from "./core-commands";
import { operationsFor, operationsRecord, installmentAmounts, installmentPaid, addMonths, nextPeriodDate, type Installment, type Agreement, type Period, type ProjectOperations } from "./project-operations";
import type { Workspace } from "./workspace-types";

export const OPERATIONS_ACTIONS = new Set(["save_person", "save_columns", "save_budget", "save_agreement", "issue_period", "record_installment_payment", "add_task_comment", "add_task_delivery"]);
const fail = (message: string): never => { throw new CoreValidationError(message); };
const text = (value: unknown, max = 180) => typeof value === "string" && value.trim().length <= max ? value.trim() : fail("El texto es demasiado largo o no es válido.");
const required = (value: unknown, label: string) => text(value) || fail(`${label} es obligatorio.`);
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(Number(value)) && Number(value) >= min && Number(value) <= max ? Number(value) : fail("El importe debe ser un número entero válido.");
export function validDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T12:00:00Z`)) || new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value) fail("La fecha no es válida.");
  return value as string;
}
const currencyCode = (value: unknown) => { const code = text(value, 3).toUpperCase(); if (!/^[A-Z]{3}$/.test(code)) fail("La moneda debe tener un código de tres letras."); try { new Intl.NumberFormat("es-CO", { style: "currency", currency: code }); } catch { fail("Moneda no válida."); } return code; };
export function operationsChange(state: Workspace, projectId: string, data: ProjectOperations, now: string): CoreChange {
  const previous = operationsRecord(state, projectId);
  const userId = state.projects.find(p => p.id === projectId)!.userId;
  // Change the guarded JSON even for link rotation or an identical save in
  // the same millisecond; timestamps alone cannot distinguish those writes.
  data.revision = operationsFor(state, projectId).revision + 1;
  const serialized = JSON.stringify(data);
  if (new TextEncoder().encode(serialized).length > 2 * 1024 * 1024) fail("El proyecto alcanzó el límite de datos operativos. Conserva el historial y crea un nuevo acuerdo/proyecto para continuar.");
  return { table: "project_operations", kind: previous ? "update" : "insert", row: databaseRow({ id: previous?.id ?? projectId, userId, projectId, data: serialized, updatedAt: now }), ...(previous ? { expected: { data: previous.data, updated_at: previous.updatedAt } } : {}) };
}
export function buildOperationsCommand(state: Workspace, userId: string, action: string, payload: Row, commandId: string, now = new Date().toISOString(), uuid = () => crypto.randomUUID()) {
  const project = state.projects.find(p => p.id === payload.projectId && p.userId === userId) ?? fail("Proyecto no encontrado.");
  const projectId = project.id, previous = operationsRecord(state, projectId), data = operationsFor(state, projectId);
  if (payload.operationsUpdatedAt !== undefined && payload.operationsUpdatedAt !== (previous?.updatedAt ?? null)) throw new CoreValidationError("El proyecto cambió. Recarga antes de guardar.", 409);
  let id = "", title = "", description = "", eventType = "organization";
  const person = (value: unknown) => data.people.find(p => p.id === value && p.active) ?? fail("Selecciona una persona activa de este proyecto.");
  const task = () => state.tasks.find(t => t.id === payload.taskId && t.projectId === projectId) ?? fail("Tarea no encontrada en el proyecto.");
  if (action === "save_person") {
    const old = data.people.find(p => p.id === payload.id);
    if (payload.id && !old) fail("Persona no encontrada.");
    if (!old && data.people.length >= 100) fail("Un proyecto puede tener hasta 100 personas.");
    id = old?.id ?? uuid();
    const value = { id, name: required(payload.name, "El nombre"), email: text(payload.email ?? "", 254), role: text(payload.role ?? ""), isSelf: payload.isSelf === true, active: payload.active !== false };
    if (value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) fail("El correo no es válido.");
    if (value.isSelf && data.people.some(p => p.id !== id && p.isSelf && p.active)) fail("Ya hay una persona identificada como tú en este proyecto.");
    if (!value.active && Object.values(data.taskDetails).some(d => d.primaryId === id || d.collaboratorIds.includes(id))) fail("Reasigna las tareas antes de desactivar a esta persona.");
    data.people = old ? data.people.map(p => p.id === id ? value : p) : [...data.people, value];
    title = old ? "Persona actualizada" : "Persona añadida al proyecto"; description = value.name;
  } else if (action === "save_columns") {
    if (!Array.isArray(payload.columns) || payload.columns.length < 2 || payload.columns.length > 12) fail("Configura entre 2 y 12 columnas.");
    data.columns = (payload.columns as Row[]).map(c => ({ id: text(c.id ?? uuid(), 100), name: required(c.name, "El nombre de columna"), status: text(c.status, 40) }));
    if (new Set(data.columns.map(c => c.id)).size !== data.columns.length || data.columns.some(c => !c.id || !TASK_STATUSES.includes(c.status)) || !data.columns.some(c => c.status === "completed")) fail("Las columnas deben tener identificadores únicos, estados válidos y una columna de completadas.");
    for (const detail of Object.values(data.taskDetails)) if (detail.columnId && !data.columns.some(c => c.id === detail.columnId)) detail.columnId = null;
    id = projectId; title = "Tablero configurado"; description = data.columns.map(c => `${c.name}: ${c.status}`).join(", ");
  } else if (action === "save_budget") {
    const currency = currencyCode(payload.currency), amount = integer(payload.amount);
    data.budgets = [...data.budgets.filter(b => b.currency !== currency), { currency, amount }];
    id = projectId; title = "Presupuesto de gastos actualizado"; description = `${amount} ${currency}`; eventType = "financial";
  } else if (action === "save_agreement") {
    const old = data.agreements.find(a => a.id === payload.id);
    if (payload.id && !old) fail("Acuerdo no encontrado.");
    if (!old && data.agreements.length >= 100) fail("Un proyecto puede tener hasta 100 acuerdos.");
    const direction = payload.direction === "expense" ? "expense" : payload.direction === "income" ? "income" : fail("Elige ingreso o gasto.");
    const mode = ["fixed", "finite", "periodic"].includes(String(payload.mode)) ? payload.mode as Agreement["mode"] : fail("Modalidad no válida.");
    const currency = currencyCode(payload.currency), totalValue = integer(payload.totalValue, 1), startDate = validDate(payload.startDate) ?? fail("Define la fecha de inicio.");
    const intervalMonths = integer(payload.intervalMonths ?? 1, 1, 12);
    const personId = payload.personId ? person(payload.personId).id : null;
    if (old && (old.direction !== direction || old.currency !== currency || old.mode !== mode)) fail("Se conservan el tipo, moneda y modalidad del acuerdo. Crea otro acuerdo para cambiarlos.");
    if (old?.mode === "periodic" && (old.startDate !== startDate || old.intervalMonths !== intervalMonths)) fail("Se conserva el calendario de períodos emitidos. Crea otro acuerdo para una nueva frecuencia.");
    if (!Array.isArray(payload.installments) || !payload.installments.length || payload.installments.length > 60) fail("Configura entre 1 y 60 cuotas.");
    const installments: Installment[] = (payload.installments as Row[]).map((item, index) => {
      const percent = Number(item.percentage ?? Number(item.basisPoints) / 100);
      if (!Number.isFinite(percent) || percent <= 0 || percent > 100 || Math.abs(percent * 100 - Math.round(percent * 100)) > 0.000001) fail("Cada porcentaje debe estar entre 0,01 y 100, con hasta dos decimales.");
      const milestoneId = item.milestoneId ? text(item.milestoneId, 100) : null;
      if (milestoneId && !state.milestones.some(m => m.id === milestoneId && m.projectId === projectId)) fail("El hito no pertenece al proyecto.");
      return { id: item.id ? text(item.id, 100) : uuid(), name: required(item.name, "El nombre de cuota"), basisPoints: Math.round(percent * 100), dueDate: validDate(item.dueDate || (mode === "finite" ? addMonths(startDate, index * intervalMonths) : null)), milestoneId };
    });
    if (installments.reduce((sum, item) => sum + item.basisPoints, 0) !== 10000) fail("Los porcentajes deben sumar exactamente 100%.");
    if (new Set(installments.map(i => i.id)).size !== installments.length) fail("Las cuotas deben tener identificadores únicos.");
    const reason = old ? required(payload.reason, "El motivo de la revisión") : text(payload.reason ?? "Acuerdo inicial");
    id = old?.id ?? uuid();
    const legacyFinancial = state.financials.find(f => f.projectId === projectId);
    const legacy = old?.legacy ?? (payload.importLegacy === true && direction === "income" && !!legacyFinancial && !data.agreements.some(a => a.legacy));
    if (payload.importLegacy && (!legacyFinancial || data.agreements.some(a => a.legacy))) fail("El saldo inicial ya fue incorporado o no existe.");
    if (legacy && legacyFinancial && legacyFinancial.currency !== currency) fail("Conserva la moneda del saldo inicial.");
    const revision = { number: (old?.revisions.length ?? 0) + 1, date: now, reason, totalValue, installments, mode, startDate, intervalMonths, title: required(payload.title, "El nombre del acuerdo") };
    const value: Agreement = { id, direction, title: revision.title, personId, currency, mode, totalValue, startDate, intervalMonths, installments, periods: old?.periods ?? [], revisions: [...(old?.revisions ?? []), revision], legacy };
    if (!old) value.periods = [{ id: uuid(), key: startDate, label: mode === "periodic" ? `Período ${startDate}` : "Acuerdo completo", startDate, totalValue, installments: installmentAmounts(totalValue, installments) }];
    else if (mode !== "periodic") {
      const period = value.periods[0], updated = installmentAmounts(totalValue, installments);
      for (const movement of data.movements.filter(m => m.agreementId === id)) if (!updated.some(i => i.id === movement.installmentId)) fail("No puedes eliminar una cuota con movimientos registrados.");
      for (const item of updated) if (item.amount < installmentPaid(data, id, period.id, item.id)) fail("La revisión no puede reducir una cuota por debajo del dinero ya registrado.");
      value.periods = [{ ...period, totalValue, installments: updated }];
    }
    if (!old && legacy && legacyFinancial?.amountPaid) {
      let remaining = legacyFinancial.amountPaid;
      if (remaining > totalValue) fail("El nuevo total no puede ser menor que el saldo recibido anteriormente.");
      for (const item of value.periods[0].installments) {
        const amount = Math.min(remaining, item.amount); if (amount) data.movements.push({ id: uuid(), agreementId: id, periodId: value.periods[0].id, installmentId: item.id, amount, date: now.slice(0, 10), reference: "Saldo inicial conservado; detalle histórico disponible en Historial", opening: true });
        remaining -= amount;
      }
    }
    data.agreements = old ? data.agreements.map(a => a.id === id ? value : a) : [...data.agreements, value];
    title = old ? "Acuerdo revisado" : "Acuerdo creado"; description = `${value.title}: ${totalValue} ${currency}. Versión ${revision.number}. ${reason}${old && mode === "periodic" ? " Los períodos ya emitidos se conservan; la revisión aplica a los siguientes." : ""}`; eventType = "financial";
  } else if (action === "issue_period") {
    const agreement = data.agreements.find(a => a.id === payload.agreementId && a.mode === "periodic") ?? fail("Selecciona un acuerdo recurrente por período.");
    if (agreement.periods.length >= 240) fail("El acuerdo alcanzó 240 períodos; crea un nuevo acuerdo para continuar.");
    const startDate = nextPeriodDate(agreement), offsetMonths = agreement.periods.length * agreement.intervalMonths;
    if (agreement.periods.some(p => p.key === startDate)) fail("Este período ya está emitido.");
    const items = agreement.installments.map(i => ({ ...i, dueDate: i.dueDate ? addMonths(i.dueDate, offsetMonths) : null }));
    const period: Period = { id: uuid(), key: startDate, label: `Período ${startDate}`, startDate, totalValue: agreement.totalValue, installments: installmentAmounts(agreement.totalValue, items) };
    agreement.periods.push(period); id = period.id; title = "Período emitido"; description = `${agreement.title}: ${startDate}, ${period.totalValue} ${agreement.currency}`; eventType = "financial";
  } else if (action === "record_installment_payment") {
    const agreement = data.agreements.find(a => a.id === payload.agreementId) ?? fail("Acuerdo no encontrado.");
    const period = agreement.periods.find(p => p.id === payload.periodId) ?? fail("Período no encontrado.");
    const installment = period.installments.find(i => i.id === payload.installmentId) ?? fail("Cuota no encontrada.");
    const amount = integer(payload.amount, 1), date = validDate(payload.date) ?? fail("Define la fecha del movimiento.");
    if (amount + installmentPaid(data, agreement.id, period.id, installment.id) > installment.amount) fail("El abono supera el saldo pendiente de esta cuota.");
    id = commandId;
    data.movements.push({ id, agreementId: agreement.id, periodId: period.id, installmentId: installment.id, amount, date, reference: text(payload.reference ?? "", 500), opening: false });
    title = agreement.direction === "income" ? "Ingreso registrado" : "Gasto pagado"; description = `${agreement.title} · ${installment.name}: ${amount} ${agreement.currency} · Fecha: ${date}`; eventType = "payment";
  } else if (action === "add_task_comment") {
    const selected = task(); id = commandId;
    const personId = payload.personId ? person(payload.personId).id : null;
    const body = text(payload.body, 2000) || fail("Escribe un comentario.");
    data.comments.push({ id, taskId: selected.id, personId, body, createdAt: now }); title = "Comentario añadido"; description = `${selected.title}: ${body}`;
  } else if (action === "add_task_delivery") {
    const selected = task(); id = commandId;
    const personId = payload.personId ? person(payload.personId).id : null;
    const key = text(payload.key, 500);
    if (!key.startsWith(`${userId}/${projectId}/shared-deliveries/`) || key.split("/").includes("..")) fail("Ruta de entregable no válida.");
    data.deliveries.push({ id, taskId: selected.id, personId, name: required(payload.name, "El nombre"), key, size: integer(payload.size, 1, 10 * 1024 * 1024), mime: text(payload.mime, 100), createdAt: now }); title = "Entregable adjuntado"; description = `${selected.title}: ${payload.name}`;
  } else fail("Acción no soportada.");
  return { id, projectId, changes: [operationsChange(state, projectId, data, now), { table: "project_events", kind: "insert" as const, row: databaseRow({ id: commandId, userId, projectId, eventType, title, description, sourceType: "manual", sourceId: id, eventDate: now, createdAt: now }) }] };
}

