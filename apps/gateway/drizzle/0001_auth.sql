CREATE TABLE "owner_account" (
	"id" text PRIMARY KEY DEFAULT 'owner' NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret_enc" text NOT NULL,
	"totp_last_step" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_account_singleton" CHECK ("owner_account"."id" = 'owner')
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "refresh_expires_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "revoked_at" timestamp with time zone;