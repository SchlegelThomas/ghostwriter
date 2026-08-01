UPDATE "provider_credentials"
SET "provider" = 'openai'
WHERE "provider" IS NULL OR trim("provider") = '';
--> statement-breakpoint
ALTER TABLE "provider_credentials" DROP CONSTRAINT "provider_credentials_pkey";
--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_account_id_provider_pk" PRIMARY KEY("account_id","provider");
