-- Before Substack had its own connector, "Sync this list" stored Substack saves under the
-- site's domain ("substack.com", or a newsletter's "name.substack.com"). They belong to the
-- "substack" platform now. Move each one over, keeping its status and save time, unless the
-- connector already has the same item; the leftovers are those duplicates.
UPDATE "bookmarks" AS b
SET "platform" = 'substack', "updated_at" = now()
WHERE b."id" IN (
    SELECT DISTINCT ON ("user_id", "external_id") "id"
    FROM "bookmarks"
    WHERE "platform" ~ '^([a-z0-9-]+\.)?substack\.com$'
    ORDER BY "user_id", "external_id", "saved_at"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "bookmarks" AS o
    WHERE o."user_id" = b."user_id" AND o."platform" = 'substack' AND o."external_id" = b."external_id"
  );--> statement-breakpoint
DELETE FROM "bookmarks" WHERE "platform" ~ '^([a-z0-9-]+\.)?substack\.com$';
