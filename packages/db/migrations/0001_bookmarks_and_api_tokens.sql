CREATE TYPE "public"."bookmark_status" AS ENUM('unread', 'opened', 'done', 'archived');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('browser', 'x', 'instagram', 'linkedin', 'reddit', 'youtube', 'github', 'manual');--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"preview" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "bookmarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"external_id" text NOT NULL,
	"url" text NOT NULL,
	"canonical_url" text NOT NULL,
	"title" text,
	"author" text,
	"text" text,
	"thumbnail_url" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "bookmark_status" DEFAULT 'unread' NOT NULL,
	"saved_at" timestamp with time zone NOT NULL,
	"snooze_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_tokens_user_id_index" ON "api_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bookmarks_user_id_platform_external_id_index" ON "bookmarks" USING btree ("user_id","platform","external_id");--> statement-breakpoint
CREATE INDEX "bookmarks_user_id_saved_at_id_index" ON "bookmarks" USING btree ("user_id","saved_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "bookmarks_user_id_canonical_url_index" ON "bookmarks" USING btree ("user_id","canonical_url");--> statement-breakpoint
CREATE INDEX "bookmarks_user_id_snooze_until_index" ON "bookmarks" USING btree ("user_id","snooze_until") WHERE "bookmarks"."snooze_until" is not null;