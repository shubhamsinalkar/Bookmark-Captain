ALTER TABLE "bookmarks" ALTER COLUMN "platform" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_platform_format" CHECK ("bookmarks"."platform" ~ '^[a-z0-9][a-z0-9.-]{0,252}$');--> statement-breakpoint
DROP TYPE "public"."platform";