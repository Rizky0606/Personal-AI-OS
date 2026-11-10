CREATE TYPE "public"."skill_source" AS ENUM('user', 'installed', 'agent');--> statement-breakpoint
CREATE TYPE "public"."skill_status" AS ENUM('active', 'disabled', 'archived');--> statement-breakpoint
CREATE TYPE "public"."skill_trust" AS ENUM('official', 'trusted', 'community');--> statement-breakpoint
CREATE TABLE "catalog_skill_versions" (
	"skill_id" text NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"body" text NOT NULL,
	"changed_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_skill_versions_skill_id_version_pk" PRIMARY KEY("skill_id","version")
);
--> statement-breakpoint
CREATE TABLE "catalog_skills" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"body" text NOT NULL,
	"source" "skill_source" NOT NULL,
	"trust" "skill_trust" DEFAULT 'community' NOT NULL,
	"status" "skill_status" DEFAULT 'active' NOT NULL,
	"engines" text[] DEFAULT ARRAY['hermes','omp','dsh']::text[] NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"origin" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_overrides" (
	"skill_id" text PRIMARY KEY NOT NULL,
	"status" "skill_status" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catalog_skill_versions" ADD CONSTRAINT "catalog_skill_versions_skill_id_catalog_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."catalog_skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_skills_status_idx" ON "catalog_skills" USING btree ("status");