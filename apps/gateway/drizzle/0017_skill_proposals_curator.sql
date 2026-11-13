CREATE TABLE "skill_curator_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"report" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_hermes_seen" (
	"name" text PRIMARY KEY NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_opens" (
	"skill_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_opens_skill_id_run_id_pk" PRIMARY KEY("skill_id","run_id")
);
--> statement-breakpoint
CREATE TABLE "skill_proposals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"origin" text NOT NULL,
	"target_id" text,
	"hermes_name" text,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"scan" jsonb NOT NULL,
	"conversation_id" uuid,
	"run_id" uuid,
	"message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"result_skill_id" text
);
--> statement-breakpoint
ALTER TABLE "catalog_skills" ADD COLUMN "stale_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "catalog_skills" ADD COLUMN "restored_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "skill_opens" ADD CONSTRAINT "skill_opens_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_proposals" ADD CONSTRAINT "skill_proposals_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_proposals" ADD CONSTRAINT "skill_proposals_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_proposals" ADD CONSTRAINT "skill_proposals_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "skill_curator_reports_created_idx" ON "skill_curator_reports" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "skill_opens_opened_idx" ON "skill_opens" USING btree ("opened_at");--> statement-breakpoint
CREATE INDEX "skill_proposals_status_idx" ON "skill_proposals" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "skill_proposals_conversation_idx" ON "skill_proposals" USING btree ("conversation_id");