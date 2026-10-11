import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
};

// Project-scoped operational aggregate; updates use a compare-and-swap guard
// and are committed atomically with tasks, payments and their timeline event.
export const projectOperations = sqliteTable("project_operations", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), projectId: text("project_id").notNull(),
  data: text("data").notNull(), updatedAt: text("updated_at").notNull(),
}, table => [uniqueIndex("idx_operations_owner_project").on(table.userId, table.projectId)]);

export const projectShares = sqliteTable("project_shares", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), projectId: text("project_id").notNull(),
  personId: text("person_id").notNull(), tokenHash: text("token_hash").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  requestCount: integer("request_count").notNull().default(0), windowStart: text("window_start").notNull(),
  ...timestamps,
}, table => [uniqueIndex("idx_shares_token").on(table.tokenHash), index("idx_shares_person").on(table.userId, table.projectId, table.personId)]);

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  shortCode: text("short_code").notNull(),
  description: text("description").notNull().default(""),
  projectType: text("project_type").notNull(),
  operationalStatus: text("operational_status").notNull(),
  commercialStatus: text("commercial_status").notNull(),
  priority: integer("priority").notNull().default(3),
  strategicPriority: integer("strategic_priority").notNull().default(3),
  targetEndDate: text("target_end_date"),
  currentSummary: text("current_summary").notNull().default(""),
  nextStepSummary: text("next_step_summary").notNull().default(""),
  blockedReason: text("blocked_reason"),
  accent: text("accent").notNull().default("lime"),
  ...timestamps,
}, (table) => [index("idx_projects_user_status").on(table.userId, table.operationalStatus)]);

export const milestones = sqliteTable("milestones", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(),
  projectId: text("project_id").notNull().references(() => projects.id),
  name: text("name").notNull(), description: text("description").notNull().default(""),
  status: text("status").notNull().default("pending"), targetDate: text("target_date"),
  completedAt: text("completed_at"), position: integer("position").notNull().default(0),
}, (table) => [index("idx_milestones_project").on(table.userId, table.projectId)]);

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(),
  projectId: text("project_id").notNull().references(() => projects.id),
  milestoneId: text("milestone_id").references(() => milestones.id), parentTaskId: text("parent_task_id"),
  title: text("title").notNull(), description: text("description").notNull().default(""),
  status: text("status").notNull().default("pending"), priority: integer("priority").notNull().default(3),
  urgency: integer("urgency").notNull().default(3), estimatedMinutes: integer("estimated_minutes").notNull().default(30),
  deadline: text("deadline"), tentativeDeliveryDate: text("tentative_delivery_date"), originMeetingId: text("origin_meeting_id"),
  scheduledStart: text("scheduled_start"), scheduledEnd: text("scheduled_end"),
  isBlocked: integer("is_blocked", { mode: "boolean" }).notNull().default(false), blockingReason: text("blocking_reason"),
  sourceType: text("source_type").notNull().default("manual"), sourceId: text("source_id"),
  aiGenerated: integer("ai_generated", { mode: "boolean" }).notNull().default(false),
  approved: integer("approved", { mode: "boolean" }).notNull().default(true), completedAt: text("completed_at"),
  ...timestamps,
}, (table) => [index("idx_tasks_user_status_deadline").on(table.userId, table.status, table.deadline), index("idx_tasks_project_status").on(table.projectId, table.status)]);

export const taskDependencies = sqliteTable("task_dependencies", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(),
  taskId: text("task_id").notNull().references(() => tasks.id),
  dependsOnTaskId: text("depends_on_task_id").notNull().references(() => tasks.id),
  dependencyType: text("dependency_type").notNull(),
}, (table) => [index("idx_dependencies_task").on(table.userId, table.taskId)]);

export const taskEvidence = sqliteTable("task_evidence", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), taskId: text("task_id").notNull().references(() => tasks.id),
  sourceType: text("source_type").notNull(), sourceReference: text("source_reference").notNull(), description: text("description").notNull().default(""),
});

export const projectFinancials = sqliteTable("project_financials", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), projectId: text("project_id").notNull().references(() => projects.id),
  totalValue: integer("total_value").notNull().default(0), currency: text("currency").notNull().default("COP"),
  paymentStatus: text("payment_status").notNull().default("not_applicable"), amountPaid: integer("amount_paid").notNull().default(0),
  amountPending: integer("amount_pending").notNull().default(0), paymentStructure: text("payment_structure").notNull().default(""), notes: text("notes").notNull().default(""),
});

export const projectEvents = sqliteTable("project_events", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), projectId: text("project_id").notNull().references(() => projects.id),
  eventType: text("event_type").notNull(), title: text("title").notNull(), description: text("description").notNull().default(""),
  sourceType: text("source_type").notNull().default("manual"), sourceId: text("source_id"), eventDate: text("event_date").notNull(), createdAt: text("created_at").notNull(),
}, (table) => [index("idx_events_project_date").on(table.userId, table.projectId, table.eventDate)]);

export const aiSuggestions = sqliteTable("ai_suggestions", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), projectId: text("project_id").references(() => projects.id),
  suggestionType: text("suggestion_type").notNull(), title: text("title").notNull(), reason: text("reason").notNull(), confidence: integer("confidence").notNull().default(70),
  evidence: text("evidence").notNull().default(""), impact: text("impact").notNull().default(""), status: text("status").notNull().default("pending"),
  payload: text("payload").notNull().default("{}"), createdAt: text("created_at").notNull(),
}, (table) => [index("idx_suggestions_user_status").on(table.userId, table.status)]);

export const inboxItems = sqliteTable("inbox_items", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), content: text("content").notNull(), inputType: text("input_type").notNull().default("text"),
  detectedProjectId: text("detected_project_id").references(() => projects.id), classification: text("classification").notNull().default("Sin clasificar"),
  status: text("status").notNull().default("unprocessed"), createdAt: text("created_at").notNull(),
}, (table) => [index("idx_inbox_user_status").on(table.userId, table.status)]);

export const calendarBlocks = sqliteTable("calendar_blocks", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), projectId: text("project_id").notNull().references(() => projects.id), taskId: text("task_id").references(() => tasks.id),
  title: text("title").notNull(), startsAt: text("starts_at").notNull(), endsAt: text("ends_at").notNull(), status: text("status").notNull().default("proposed"), createdAt: text("created_at").notNull(),
}, (table) => [index("idx_calendar_user_start").on(table.userId, table.startsAt)]);

export const knowledgeItems = sqliteTable("knowledge_items", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), projectId: text("project_id").notNull().references(() => projects.id),
  itemType: text("item_type").notNull(), title: text("title").notNull(), summary: text("summary").notNull().default(""), sourceReference: text("source_reference"),
  storageKey: text("storage_key"), processingStatus: text("processing_status").notNull().default("ready"), occurredAt: text("occurred_at").notNull(),
}, (table) => [index("idx_knowledge_project").on(table.userId, table.projectId)]);

export const repositories = sqliteTable("repositories", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), projectId: text("project_id").notNull().references(() => projects.id),
  provider: text("provider").notNull().default("github"), owner: text("owner").notNull(), repo: text("repo").notNull(), defaultBranch: text("default_branch").notNull().default("main"),
  lastSync: text("last_sync"), status: text("status").notNull().default("disconnected"),
});

// Server-only AI usage/history. Project records remain in the selected backend.
export const aiRuns = sqliteTable("ai_runs", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), scope: text("scope").notNull(),
  kind: text("kind").notNull(), query: text("query").notNull(), result: text("result").notNull().default(""),
  status: text("status").notNull(), dayKey: text("day_key").notNull(), createdAt: text("created_at").notNull(),
  model: text("model").notNull(), inputTokens: integer("input_tokens").notNull().default(0), outputTokens: integer("output_tokens").notNull().default(0),
}, (table) => [index("idx_ai_runs_user_day").on(table.userId, table.dayKey), index("idx_ai_runs_user_scope_created").on(table.userId, table.scope, table.createdAt)]);

// Server-only bridge, like AI history. Operational projects may live in
// Supabase, so no foreign key to the optional local demonstration projects.
export const projectBrainSources = sqliteTable("project_brain_sources", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), projectId: text("project_id").notNull(),
  knowledgeId: text("knowledge_id").notNull(), title: text("title").notNull(),
  brainId: text("brain_id").notNull(), sourceId: text("source_id").notNull(), sourceType: text("source_type").notNull(),
  externalReference: text("external_reference").notNull(), contentHash: text("content_hash").notNull(),
  requestId: text("request_id").notNull(), status: text("status").notNull(), error: text("error").notNull().default(""),
  indexedAt: text("indexed_at"), createdAt: text("created_at").notNull(),
}, (table) => [index("idx_brain_sources_user_project").on(table.userId, table.projectId)]);

export const brainRequests = sqliteTable("brain_requests", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), projectId: text("project_id").notNull(),
  kind: text("kind").notNull(), payloadHash: text("payload_hash").notNull(), status: text("status").notNull(),
  dayKey: text("day_key").notNull(), createdAt: text("created_at").notNull(),
  leaseUntil: text("lease_until").notNull(), attempts: integer("attempts").notNull().default(1), result: text("result").notNull().default(""),
}, (table) => [index("idx_brain_requests_user_day").on(table.userId, table.dayKey)]);

// Local textual index of original documents. It never stores video, credentials
// or embeddings and works regardless of the operational backend (Supabase/D1).
export const knowledgeSearch = sqliteTable("knowledge_search", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), projectId: text("project_id").notNull(),
  knowledgeId: text("knowledge_id").notNull(), fingerprint: text("fingerprint").notNull(),
  content: text("content").notNull().default(""), normalizedContent: text("normalized_content").notNull().default(""),
  status: text("status").notNull(), error: text("error").notNull().default(""), indexedAt: text("indexed_at").notNull(),
}, (table) => [index("idx_knowledge_search_user").on(table.userId,table.knowledgeId)]);
