DROP TABLE "routing_corrections" CASCADE;--> statement-breakpoint
-- Role lama dilebur jadi dua agent: coding (frontend, backend, debugger, reviewer) menjadi project, writer menjadi general.
UPDATE "messages" SET "agent_role" = 'project' WHERE "agent_role" IN ('frontend', 'backend', 'debugger', 'reviewer');--> statement-breakpoint
UPDATE "messages" SET "agent_role" = 'general' WHERE "agent_role" = 'writer';--> statement-breakpoint
UPDATE "runs" SET "agent_role" = 'project' WHERE "agent_role" IN ('frontend', 'backend', 'debugger', 'reviewer');--> statement-breakpoint
UPDATE "runs" SET "agent_role" = 'general' WHERE "agent_role" = 'writer';--> statement-breakpoint
UPDATE "tasks" SET "agent_role" = 'project' WHERE "agent_role" IN ('frontend', 'backend', 'debugger', 'reviewer');--> statement-breakpoint
UPDATE "tasks" SET "agent_role" = 'general' WHERE "agent_role" = 'writer';--> statement-breakpoint
UPDATE "schedules" SET "agent_role" = 'project' WHERE "agent_role" IN ('frontend', 'backend', 'debugger', 'reviewer');--> statement-breakpoint
UPDATE "schedules" SET "agent_role" = 'general' WHERE "agent_role" = 'writer';--> statement-breakpoint
UPDATE "routing_decisions" SET "role" = 'project' WHERE "role" IN ('frontend', 'backend', 'debugger', 'reviewer');--> statement-breakpoint
UPDATE "routing_decisions" SET "role" = 'general' WHERE "role" = 'writer';
