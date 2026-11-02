CREATE TABLE "user_settings" (
	"userId" bigint PRIMARY KEY NOT NULL,
	"language" text,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
