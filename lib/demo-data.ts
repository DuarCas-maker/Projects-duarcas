export const NOW_ISO = "2026-10-04T13:00:00.000Z";

export const DEMO_PROJECTS = [
  { id: "lyn", name: "Grupo LYN", shortCode: "LYN", description: "Desarrollo y soporte continuo para la operación digital.", projectType: "Recurrente", operationalStatus: "Activo", commercialStatus: "Recurrente", priority: 5, strategicPriority: 5, targetEndDate: null, currentSummary: "Operación activa. Una incidencia en el registro de horas requiere atención inmediata.", nextStepSummary: "Resolver la validación del registro de horas.", blockedReason: null, accent: "lime" },
  { id: "erm", name: "ERM", shortCode: "ERM", description: "Sistema de generación de briefs mediante voz.", projectType: "Por alcance", operationalStatus: "Por iniciar", commercialStatus: "Pagado", priority: 5, strategicPriority: 4, targetEndDate: "2026-11-15", currentSummary: "Proyecto pagado y listo para iniciar. El cronograma aún no ha sido comunicado.", nextStepSummary: "Enviar cronograma de desarrollo.", blockedReason: null, accent: "blue" },
  { id: "charlo", name: "Charlo", shortCode: "CHA", description: "Sitio web de marca con entrega aproximada en cinco semanas.", projectType: "Por alcance", operationalStatus: "Activo", commercialStatus: "Pagado", priority: 4, strategicPriority: 4, targetEndDate: "2026-11-08", currentSummary: "Arquitectura definida. Falta validar los insumos de branding antes de avanzar al diseño visual.", nextStepSummary: "Revisar insumos de branding con el cliente.", blockedReason: "Esperando manual de marca", accent: "violet" },
  { id: "santi", name: "Santi Curated", shortCode: "SC", description: "Producto de prospección, evaluación y seguimiento comercial.", projectType: "Producto", operationalStatus: "Activo", commercialStatus: "Propio", priority: 5, strategicPriority: 5, targetEndDate: "2026-12-18", currentSummary: "El sistema Seller está en definición de arquitectura y modelo de riesgo.", nextStepSummary: "Cerrar arquitectura del módulo Seller.", blockedReason: null, accent: "orange" },
  { id: "brant", name: "Brant", shortCode: "BRA", description: "Construcción, marketing y automatización para lanzamiento.", projectType: "Propio", operationalStatus: "Activo", commercialStatus: "Propio", priority: 3, strategicPriority: 4, targetEndDate: "2026-12-01", currentSummary: "Construcción en marcha. Marketing necesita aterrizar la secuencia de lanzamiento.", nextStepSummary: "Definir embudo de lanzamiento.", blockedReason: null, accent: "cyan" },
  { id: "malajunta", name: "Malajunta", shortCode: "MAL", description: "Soporte posterior al desarrollo principal.", projectType: "Soporte", operationalStatus: "Soporte", commercialStatus: "Pagado", priority: 2, strategicPriority: 2, targetEndDate: null, currentSummary: "Desarrollo y pago terminados; quedan ajustes menores no urgentes.", nextStepSummary: "Agrupar ajustes pequeños para una sesión de soporte.", blockedReason: null, accent: "pink" },
  { id: "arrendamientos", name: "Arrendamientos", shortCode: "ARR", description: "Operación recurrente de apartamentos, contratos y renovaciones.", projectType: "Operación", operationalStatus: "Activo", commercialStatus: "Interno", priority: 4, strategicPriority: 3, targetEndDate: null, currentSummary: "Dos renovaciones se aproximan en octubre.", nextStepSummary: "Revisar contrato del apartamento 302.", blockedReason: null, accent: "yellow" },
  { id: "banivado", name: "El Banivado", shortCode: "BAN", description: "MVP para generación, scoring y gestión de leads.", projectType: "Negociación", operationalStatus: "Negociación", commercialStatus: "Propuesta enviada", priority: 3, strategicPriority: 3, targetEndDate: null, currentSummary: "Propuesta enviada; se espera confirmación de la siguiente reunión.", nextStepSummary: "Hacer seguimiento a la propuesta.", blockedReason: "Pendiente respuesta del cliente", accent: "red" },
  { id: "mashiramo", name: "Mashiramo", shortCode: "MAS", description: "Marca propia de accesorios para mascotas.", projectType: "Propio", operationalStatus: "Pausado", commercialStatus: "Propio", priority: 1, strategicPriority: 2, targetEndDate: null, currentSummary: "Proyecto pausado para proteger el foco de los proyectos activos.", nextStepSummary: "Revisar continuidad en diciembre.", blockedReason: null, accent: "gray" },
  { id: "contenido", name: "Es la que hay", shortCode: "ELQH", description: "Producción de contenido para TikTok.", projectType: "Contenido", operationalStatus: "Activo", commercialStatus: "Propio", priority: 3, strategicPriority: 3, targetEndDate: null, currentSummary: "Hay tres ideas listas para pasar a guion.", nextStepSummary: "Escribir guion del episodio sobre producto.", blockedReason: null, accent: "green" },
];

export const DEMO_MILESTONES = [
  { id: "m-lyn-ops", projectId: "lyn", name: "Estabilidad operativa", description: "Cerrar incidencias activas", status: "in_progress", targetDate: "2026-10-07", completedAt: null, position: 1 },
  { id: "m-erm-plan", projectId: "erm", name: "Planificación", description: "Cronograma, repositorio y kickoff", status: "in_progress", targetDate: "2026-10-06", completedAt: null, position: 1 },
  { id: "m-charlo-brand", projectId: "charlo", name: "Dirección visual", description: "Insumos y primera propuesta", status: "blocked", targetDate: "2026-10-12", completedAt: null, position: 1 },
  { id: "m-santi-seller", projectId: "santi", name: "Seller foundation", description: "Arquitectura, emails y riesgo", status: "in_progress", targetDate: "2026-10-23", completedAt: null, position: 1 },
  { id: "m-brant-launch", projectId: "brant", name: "Prelanzamiento", description: "Embudo y automatizaciones", status: "pending", targetDate: "2026-11-09", completedAt: null, position: 1 },
];

export const DEMO_TASKS = [
  { id: "t-lyn-hours", projectId: "lyn", milestoneId: "m-lyn-ops", title: "Resolver incidencia del registro de horas", description: "La validación rechaza registros válidos en el cierre de jornada.", status: "ready", priority: 5, urgency: 5, estimatedMinutes: 120, deadline: "2026-10-04", scheduledStart: "2026-10-04T13:00:00.000Z", scheduledEnd: "2026-10-04T15:00:00.000Z", isBlocked: false, blockingReason: null, sourceType: "inbox", sourceId: "in-1", aiGenerated: false, approved: true, completedAt: null },
  { id: "t-erm-plan", projectId: "erm", milestoneId: "m-erm-plan", title: "Enviar cronograma de desarrollo", description: "Comunicar fases y fechas antes de crear el repositorio.", status: "ready", priority: 5, urgency: 5, estimatedMinutes: 45, deadline: "2026-10-04", scheduledStart: "2026-10-04T15:30:00.000Z", scheduledEnd: "2026-10-04T16:15:00.000Z", isBlocked: false, blockingReason: null, sourceType: "meeting", sourceId: "kickoff-erm", aiGenerated: false, approved: true, completedAt: null },
  { id: "t-charlo-brand", projectId: "charlo", milestoneId: "m-charlo-brand", title: "Revisar insumos de branding", description: "Validar logo, paleta y manual antes de diseñar.", status: "blocked", priority: 4, urgency: 4, estimatedMinutes: 60, deadline: "2026-10-05", scheduledStart: null, scheduledEnd: null, isBlocked: true, blockingReason: "Esperando manual de marca", sourceType: "meeting", sourceId: "charlo-03-10", aiGenerated: false, approved: true, completedAt: null },
  { id: "t-santi-arch", projectId: "santi", milestoneId: "m-santi-seller", title: "Definir arquitectura de Seller", description: "Delimitar flujo de prospección, validación y enriquecimiento.", status: "in_progress", priority: 5, urgency: 3, estimatedMinutes: 90, deadline: "2026-10-06", scheduledStart: "2026-10-04T19:00:00.000Z", scheduledEnd: "2026-10-04T20:30:00.000Z", isBlocked: false, blockingReason: null, sourceType: "manual", sourceId: null, aiGenerated: false, approved: true, completedAt: null },
  { id: "t-arr-302", projectId: "arrendamientos", milestoneId: null, title: "Revisar renovación apartamento 302", description: "Confirmar condiciones y fecha de aviso.", status: "pending", priority: 4, urgency: 4, estimatedMinutes: 30, deadline: "2026-10-07", scheduledStart: null, scheduledEnd: null, isBlocked: false, blockingReason: null, sourceType: "document", sourceId: "contrato-302", aiGenerated: false, approved: true, completedAt: null },
  { id: "t-brant-funnel", projectId: "brant", milestoneId: "m-brant-launch", title: "Definir embudo de lanzamiento", description: "Convertir frentes de marketing en una secuencia ejecutable.", status: "pending", priority: 3, urgency: 2, estimatedMinutes: 90, deadline: "2026-10-09", scheduledStart: null, scheduledEnd: null, isBlocked: false, blockingReason: null, sourceType: "manual", sourceId: null, aiGenerated: false, approved: true, completedAt: null },
  { id: "t-ban-follow", projectId: "banivado", milestoneId: null, title: "Hacer seguimiento a la propuesta", description: "Pedir confirmación para la siguiente reunión.", status: "pending", priority: 3, urgency: 3, estimatedMinutes: 15, deadline: "2026-10-06", scheduledStart: null, scheduledEnd: null, isBlocked: false, blockingReason: null, sourceType: "manual", sourceId: null, aiGenerated: false, approved: true, completedAt: null },
  { id: "t-content-script", projectId: "contenido", milestoneId: null, title: "Escribir guion: producto vs. feature", description: "Pasar la idea priorizada a un guion de 60 segundos.", status: "pending", priority: 3, urgency: 2, estimatedMinutes: 45, deadline: "2026-10-08", scheduledStart: null, scheduledEnd: null, isBlocked: false, blockingReason: null, sourceType: "manual", sourceId: null, aiGenerated: false, approved: true, completedAt: null },
  { id: "t-mal-support", projectId: "malajunta", milestoneId: null, title: "Agrupar ajustes de soporte", description: "Consolidar cambios menores antes de intervenir.", status: "pending", priority: 2, urgency: 1, estimatedMinutes: 25, deadline: null, scheduledStart: null, scheduledEnd: null, isBlocked: false, blockingReason: null, sourceType: "manual", sourceId: null, aiGenerated: false, approved: true, completedAt: null },
  { id: "t-erm-repo", projectId: "erm", milestoneId: "m-erm-plan", title: "Crear repositorio del proyecto", description: "Crear después de comunicar el cronograma.", status: "pending", priority: 4, urgency: 3, estimatedMinutes: 20, deadline: "2026-10-05", scheduledStart: null, scheduledEnd: null, isBlocked: true, blockingReason: "Depende del cronograma", sourceType: "voice", sourceId: "voice-erm-01", aiGenerated: false, approved: true, completedAt: null },
];

export const DEMO_DEPENDENCIES = [{ id: "dep-erm", taskId: "t-erm-repo", dependsOnTaskId: "t-erm-plan", dependencyType: "finish_to_start" }];
export const DEMO_FINANCIALS = [
  { id: "f-erm", projectId: "erm", totalValue: 18000000, currency: "COP", paymentStatus: "paid", amountPaid: 18000000, amountPending: 0, paymentStructure: "Pago inicial completo", notes: "Pago confirmado" },
  { id: "f-charlo", projectId: "charlo", totalValue: 12000000, currency: "COP", paymentStatus: "partial", amountPaid: 6000000, amountPending: 6000000, paymentStructure: "50% inicio / 50% entrega", notes: "Segundo pago contra entrega" },
  { id: "f-mal", projectId: "malajunta", totalValue: 8000000, currency: "COP", paymentStatus: "paid", amountPaid: 8000000, amountPending: 0, paymentStructure: "Completo", notes: "Cerrado" },
];

export const DEMO_EVENTS = [
  { id: "ev-1", projectId: "lyn", eventType: "incident", title: "Nueva incidencia operativa", description: "Se reportó un fallo en la validación del registro de horas.", sourceType: "inbox", sourceId: "in-1", eventDate: "2026-10-04T12:10:00.000Z" },
  { id: "ev-2", projectId: "erm", eventType: "payment", title: "Pago confirmado", description: "El proyecto quedó habilitado para iniciar.", sourceType: "manual", sourceId: null, eventDate: "2026-10-03T16:00:00.000Z" },
  { id: "ev-3", projectId: "charlo", eventType: "meeting", title: "Reunión de dirección", description: "Se acordó esperar el manual de marca antes de diseñar.", sourceType: "meeting", sourceId: "charlo-03-10", eventDate: "2026-10-03T14:00:00.000Z" },
  { id: "ev-4", projectId: "santi", eventType: "task", title: "Arquitectura Seller iniciada", description: "Se comenzó el mapa de validación y enriquecimiento.", sourceType: "manual", sourceId: null, eventDate: "2026-10-02T18:30:00.000Z" },
];

export const DEMO_SUGGESTIONS = [
  { id: "sg-1", projectId: "lyn", suggestionType: "new_task", title: "Verificar registros afectados", reason: "La incidencia podría haber dejado datos incompletos.", confidence: 86, evidence: "Actualización en Inbox · hoy 07:10", impact: "Reduce el riesgo de inconsistencias posteriores.", status: "pending", payload: "{}", createdAt: "2026-10-04T12:15:00.000Z" },
  { id: "sg-2", projectId: "erm", suggestionType: "calendar_block", title: "Reservar 45 min para el cronograma", reason: "Es la acción que desbloquea el inicio del proyecto.", confidence: 94, evidence: "Reunión inicial + pago confirmado", impact: "Permite crear el repositorio y programar el kickoff.", status: "pending", payload: "{}", createdAt: "2026-10-04T11:00:00.000Z" },
  { id: "sg-3", projectId: "charlo", suggestionType: "blocker", title: "Solicitar manual de marca", reason: "El milestone visual está detenido por un insumo externo.", confidence: 91, evidence: "Reunión 03/10/2026", impact: "Evita que el bloqueo se extienda a la siguiente semana.", status: "pending", payload: "{}", createdAt: "2026-10-04T10:30:00.000Z" },
];

export const DEMO_INBOX = [
  { id: "in-1", content: "En Grupo LYN salió una urgencia con el registro de horas.", inputType: "text", detectedProjectId: "lyn", classification: "Nueva incidencia · urgente", status: "processed", createdAt: "2026-10-04T12:10:00.000Z" },
  { id: "in-2", content: "ERM ya realizó el pago. Enviar mañana el cronograma y después crear el repositorio.", inputType: "voice", detectedProjectId: "erm", classification: "Pago + 2 acciones", status: "processed", createdAt: "2026-10-03T16:05:00.000Z" },
];

export const DEMO_CALENDAR = [
  { id: "cal-1", projectId: "lyn", taskId: "t-lyn-hours", title: "Incidencia registro de horas", startsAt: "2026-10-04T13:00:00.000Z", endsAt: "2026-10-04T15:00:00.000Z", status: "approved", createdAt: NOW_ISO },
  { id: "cal-2", projectId: "erm", taskId: "t-erm-plan", title: "Cronograma ERM", startsAt: "2026-10-04T15:30:00.000Z", endsAt: "2026-10-04T16:15:00.000Z", status: "proposed", createdAt: NOW_ISO },
  { id: "cal-3", projectId: "santi", taskId: "t-santi-arch", title: "Arquitectura Seller", startsAt: "2026-10-04T19:00:00.000Z", endsAt: "2026-10-04T20:30:00.000Z", status: "proposed", createdAt: NOW_ISO },
];

export const DEMO_KNOWLEDGE = [
  { id: "k-erm-1", projectId: "erm", itemType: "meeting", title: "Reunión inicial", summary: "Objetivo, alcance de voz y compromiso de cronograma.", sourceReference: "Reunión 03/10/2026", storageKey: null, processingStatus: "ready", occurredAt: "2026-10-03T15:00:00.000Z" },
  { id: "k-charlo-1", projectId: "charlo", itemType: "decision", title: "No diseñar sin branding", summary: "El diseño visual comenzará cuando se reciba el manual de marca.", sourceReference: "Reunión 03/10/2026", storageKey: null, processingStatus: "ready", occurredAt: "2026-10-03T14:00:00.000Z" },
  { id: "k-santi-1", projectId: "santi", itemType: "document", title: "Modelo de riesgo v1", summary: "Variables iniciales para evaluación IA y seguimiento.", sourceReference: "Documento interno", storageKey: null, processingStatus: "ready", occurredAt: "2026-10-02T17:00:00.000Z" },
];

export const DEMO_REPOSITORIES = [
  { id: "repo-lyn", projectId: "lyn", provider: "github", owner: "grupo-lyn", repo: "operations", defaultBranch: "main", lastSync: "2026-10-04T11:30:00.000Z", status: "read_only" },
  { id: "repo-santi", projectId: "santi", provider: "github", owner: "personal", repo: "santi-curated", defaultBranch: "main", lastSync: "2026-10-03T21:00:00.000Z", status: "read_only" },
];

export function getDemoState() {
  return {
    projects: DEMO_PROJECTS,
    milestones: DEMO_MILESTONES,
    tasks: DEMO_TASKS.map((task) => ({ ...task, createdAt: NOW_ISO, updatedAt: NOW_ISO })),
    dependencies: DEMO_DEPENDENCIES,
    financials: DEMO_FINANCIALS,
    events: DEMO_EVENTS.map((event) => ({ ...event, createdAt: event.eventDate })),
    suggestions: DEMO_SUGGESTIONS,
    inbox: DEMO_INBOX,
    calendar: DEMO_CALENDAR,
    knowledge: DEMO_KNOWLEDGE,
    repositories: DEMO_REPOSITORIES,
  };
}
