CREATE TABLE "albums" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "favorites" (
	"userId" bigint NOT NULL,
	"photoId" uuid NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favorites_userId_photoId_pk" PRIMARY KEY("userId","photoId")
);
--> statement-breakpoint
CREATE TABLE "photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"albumId" uuid,
	"title" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"credit" text,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"blurhash" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"telegramFileUniqueId" text,
	"createdBy" bigint,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photos_telegramFileUniqueId_unique" UNIQUE("telegramFileUniqueId")
);
--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_photoId_photos_id_fk" FOREIGN KEY ("photoId") REFERENCES "public"."photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_albumId_albums_id_fk" FOREIGN KEY ("albumId") REFERENCES "public"."albums"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "photos_album_position" ON "photos" USING btree ("albumId","position");