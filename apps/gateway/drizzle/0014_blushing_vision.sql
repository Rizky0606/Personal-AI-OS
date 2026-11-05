CREATE TYPE "public"."assignment_status" AS ENUM('queued', 'running', 'needs_review', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."lead_review_decision" AS ENUM('accept', 'revise', 'reject');--> statement-breakpoint
CREATE TABLE "team_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"worker_member_id" uuid,
	"title" text NOT NULL,
	"prompt" text NOT NULL,
	"acceptance_criteria" text NOT NULL,
	"status" "assignment_status" DEFAULT 'queued' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"max_attempts" integer NOT NULL,
	"result_summary" text,
	"result_ref" text,
	"review_status" "lead_review_decision",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"assignment_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"decision" "lead_review_decision" NOT NULL,
	"feedback" text DEFAULT '' NOT NULL,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"commit_sha" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "plan" jsonb;--> statement-breakpoint
ALTER TABLE "team_assignments" ADD CONSTRAINT "team_assignments_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_assignments" ADD CONSTRAINT "team_assignments_worker_member_id_team_members_id_fk" FOREIGN KEY ("worker_member_id") REFERENCES "public"."team_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_reviews" ADD CONSTRAINT "team_reviews_assignment_id_team_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."team_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_assignments_team_idx" ON "team_assignments" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "team_reviews_assignment_idx" ON "team_reviews" USING btree ("assignment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_reviews_assignment_attempt_idx" ON "team_reviews" USING btree ("assignment_id","attempt");