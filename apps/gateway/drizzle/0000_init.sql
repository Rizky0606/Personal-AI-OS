CREATE TYPE "public"."approval_decision" AS ENUM('allow', 'deny');--> statement-breakpoint
CREATE TYPE "public"."approval_kind" AS ENUM('command', 'file_write', 'network');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'allowed', 'denied', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."device_kind" AS ENUM('android', 'desktop', 'worker');--> statement-breakpoint
CREATE TYPE "public"."message_author" AS ENUM('user', 'assistant', 'system');--> statement-breakpoint
CREATE TYPE "public"."research_depth" AS ENUM('quick', 'standard', 'deep');--> statement-breakpoint
CREATE TYPE "public"."research_status" AS ENUM('queued', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."run_engine" AS ENUM('hermes', 'omp', 'pi', 'research');--> statement-breakpoint
CREATE TYPE "public"."run_kind" AS ENUM('chat', 'coding', 'research', 'schedule');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'routing', 'preparing', 'running', 'waiting_approval', 'needs_review', 'accepted', 'rejected', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."schedule_run_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."schedule_target" AS ENUM('chat', 'research', 'role');--> statement-breakpoint
CREATE TYPE "public"."surface" AS ENUM('android', 'windows');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('backlog', 'todo', 'running', 'review', 'done');--> statement-breakpoint
CREATE TABLE "approval_rules" (
	"project_id" uuid NOT NULL,
	"pattern" text NOT NULL,
	"decision" "approval_decision" NOT NULL,
	CONSTRAINT "approval_rules_project_id_pattern_pk" PRIMARY KEY("project_id","pattern")
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"kind" "approval_kind" NOT NULL,
	"detail" text NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"remember" boolean DEFAULT false NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"surface" "surface" NOT NULL,
	"project_id" uuid,
	"hermes_session_id" text,
	"pinned" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "device_kind" NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"push_token" text,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"author" "message_author" NOT NULL,
	"parts" jsonb NOT NULL,
	"agent_role" text,
	"model" text,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"worker_device_id" uuid NOT NULL,
	"stack" jsonb NOT NULL,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_events_run_id_seq_pk" PRIMARY KEY("run_id","seq")
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "run_kind" NOT NULL,
	"engine" "run_engine" NOT NULL,
	"agent_role" text,
	"model" text,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"conversation_id" uuid,
	"task_id" uuid,
	"branch" text,
	"usage" jsonb,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"status" "task_status" DEFAULT 'backlog' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"agent_role" text,
	"run_id" uuid,
	"branch" text,
	"diff_stat" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_device_id" uuid,
	"action" text NOT NULL,
	"target" text DEFAULT '' NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size" bigint NOT NULL,
	"storage_path" text NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"question" text NOT NULL,
	"depth" "research_depth" DEFAULT 'standard' NOT NULL,
	"status" "research_status" DEFAULT 'queued' NOT NULL,
	"plan" jsonb,
	"report_md" text,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"url" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"fetched_at" timestamp with time zone,
	"used" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routing_corrections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"decision_id" uuid NOT NULL,
	"from_role" text NOT NULL,
	"to_role" text NOT NULL,
	"message_excerpt" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routing_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"message_id" uuid NOT NULL,
	"role" text NOT NULL,
	"confidence" double precision NOT NULL,
	"reason" text NOT NULL,
	"latency_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"schedule_id" uuid NOT NULL,
	"run_id" uuid,
	"status" "schedule_run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"cron" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Jakarta' NOT NULL,
	"prompt" text NOT NULL,
	"target" "schedule_target" NOT NULL,
	"agent_role" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_rules" ADD CONSTRAINT "approval_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_worker_device_id_devices_id_fk" FOREIGN KEY ("worker_device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_device_id_devices_id_fk" FOREIGN KEY ("actor_device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_jobs" ADD CONSTRAINT "research_jobs_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_sources" ADD CONSTRAINT "research_sources_job_id_research_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."research_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_corrections" ADD CONSTRAINT "routing_corrections_decision_id_routing_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."routing_decisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_decisions" ADD CONSTRAINT "routing_decisions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_runs" ADD CONSTRAINT "schedule_runs_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_runs" ADD CONSTRAINT "schedule_runs_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_run_idx" ON "approvals" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "conversations_project_idx" ON "conversations" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id","id");--> statement-breakpoint
CREATE INDEX "runs_conversation_idx" ON "runs" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "runs_status_idx" ON "runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tasks_board_idx" ON "tasks" USING btree ("project_id","status","position");--> statement-breakpoint
CREATE INDEX "audit_log_ts_idx" ON "audit_log" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "research_sources_job_idx" ON "research_sources" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "routing_decisions_message_idx" ON "routing_decisions" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "schedule_runs_schedule_idx" ON "schedule_runs" USING btree ("schedule_id","id");