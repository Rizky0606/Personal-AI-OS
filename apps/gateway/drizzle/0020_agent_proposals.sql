CREATE TABLE "agent_proposals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"agent" text NOT NULL,
	"payload" jsonb NOT NULL,
	"reason" text NOT NULL,
	"after_web" boolean DEFAULT false NOT NULL,
	"project_id" uuid,
	"conversation_id" uuid,
	"run_id" uuid,
	"result_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "memory_proposals" ADD COLUMN "source" text DEFAULT 'extraction' NOT NULL;--> statement-breakpoint
ALTER TABLE "memory_proposals" ADD COLUMN "agent" text;--> statement-breakpoint
ALTER TABLE "memory_proposals" ADD COLUMN "after_web" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD CONSTRAINT "agent_proposals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD CONSTRAINT "agent_proposals_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD CONSTRAINT "agent_proposals_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_proposals_status_idx" ON "agent_proposals" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "agent_proposals_kind_idx" ON "agent_proposals" USING btree ("kind","created_at");--> statement-breakpoint
CREATE INDEX "agent_proposals_run_idx" ON "agent_proposals" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "memory_proposals_run_idx" ON "memory_proposals" USING btree ("run_id");