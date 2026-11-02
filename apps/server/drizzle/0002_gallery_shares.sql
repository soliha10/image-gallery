CREATE TABLE "shares" (
	"ownerId" bigint PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"ownerName" text DEFAULT '' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shares_token_unique" UNIQUE("token")
);
