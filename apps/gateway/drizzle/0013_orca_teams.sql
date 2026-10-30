CREATE TYPE "public"."team_member_role" AS ENUM('lead', 'worker');--> statement-breakpoint
CREATE TYPE "public"."team_member_status" AS ENUM('queued', 'running', 'reviewing', 'completed', 'failed', 'cancelled', 'needs_attention');--> statement-breakpoint
CREATE TYPE "public"."team_status" AS ENUM('queued', 'planning', 'running', 'reviewing', 'completed', 'failed', 'cancelled', 'needs_attention');--> statement-breakpoint
CREATE TABLE "team_events" (
	"team_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_events_team_id_seq_pk" PRIMARY KEY("team_id","seq")
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"role" "team_member_role" NOT NULL,
	"status" "team_member_status" DEFAULT 'queued' NOT NULL,
	"task" text NOT NULL,
	"acceptance_criteria" text,
	"branch" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"exit_reason" text,
	"usage" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_members_run_id_unique" UNIQUE("run_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"parent_run_id" uuid,
	"status" "team_status" DEFAULT 'queued' NOT NULL,
	"prompt" text NOT NULL,
	"limits" jsonb NOT NULL,
	"cancel_requested_at" timestamp with time zone,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "teams_parent_run_id_unique" UNIQUE("parent_run_id")
);
--> statement-breakpoint
ALTER TABLE "team_events" ADD CONSTRAINT "team_events_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_parent_run_id_runs_id_fk" FOREIGN KEY ("parent_run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_members_team_idx" ON "team_members" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "teams_project_created_idx" ON "teams" USING btree ("project_id","created_at");