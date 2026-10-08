-- pgvector ships with Neon (and the pgvector/pgvector Docker image); drizzle-kit does not emit extensions.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."enrichment_status" AS ENUM('pending', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "bookmark_embeddings" (
	"bookmark_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"model" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"source_enriched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookmarks" ADD COLUMN "enrichment_status" "enrichment_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD COLUMN "enrichment_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD COLUMN "enrichment_retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD COLUMN "enrichment_error" text;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD COLUMN "enriched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD COLUMN "headline" text;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD COLUMN "topics" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD COLUMN "content_type" text;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD COLUMN "read_minutes" integer;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD COLUMN "shelf_life" text;--> statement-breakpoint
ALTER TABLE "bookmark_embeddings" ADD CONSTRAINT "bookmark_embeddings_bookmark_id_bookmarks_id_fk" FOREIGN KEY ("bookmark_id") REFERENCES "public"."bookmarks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmark_embeddings" ADD CONSTRAINT "bookmark_embeddings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookmark_embeddings_user_id_index" ON "bookmark_embeddings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bookmarks_enrichment_queue_idx" ON "bookmarks" USING btree ("saved_at" DESC NULLS LAST) WHERE "bookmarks"."enrichment_status" = 'pending';