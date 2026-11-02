ALTER TABLE "photos" DROP CONSTRAINT "photos_telegramFileUniqueId_unique";--> statement-breakpoint
ALTER TABLE "albums" ADD COLUMN "ownerId" bigint;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "ownerId" bigint;--> statement-breakpoint
CREATE INDEX "albums_owner_position" ON "albums" USING btree ("ownerId","position");--> statement-breakpoint
CREATE INDEX "photos_owner_position" ON "photos" USING btree ("ownerId","position");--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_owner_telegram_file" UNIQUE("ownerId","telegramFileUniqueId");