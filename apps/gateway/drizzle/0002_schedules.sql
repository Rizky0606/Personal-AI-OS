ALTER TYPE "public"."schedule_run_status" ADD VALUE 'missed';--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_runs_one_running" ON "schedule_runs" USING btree ("schedule_id") WHERE "schedule_runs"."status" = 'running';