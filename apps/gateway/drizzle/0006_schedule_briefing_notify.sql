CREATE TYPE "public"."schedule_notify" AS ENUM('always', 'on_change');--> statement-breakpoint
ALTER TYPE "public"."schedule_target" ADD VALUE 'briefing';--> statement-breakpoint
ALTER TABLE "schedule_runs" ADD COLUMN "changed" boolean;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "notify" "schedule_notify" DEFAULT 'always' NOT NULL;