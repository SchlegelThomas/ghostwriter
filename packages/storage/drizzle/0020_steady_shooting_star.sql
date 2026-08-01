-- Multi-provider credentials: composite (account_id, provider).
-- Uses a new table because Lakebase CI/service-principal cannot ALTER/DROP
-- founder-owned `provider_credentials` (must be owner). App code reads/writes
-- `provider_credential_keys` going forward; the legacy table is left in place.
CREATE TABLE "provider_credential_keys" (
	"account_id" text NOT NULL,
	"provider" text NOT NULL,
	"version" integer NOT NULL,
	"kek_version" text NOT NULL,
	"ciphertext_b64" text NOT NULL,
	"iv_b64" text NOT NULL,
	"auth_tag_b64" text NOT NULL,
	"masked_hint" text NOT NULL,
	"validation_state" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"validated_at" text,
	CONSTRAINT "provider_credential_keys_pk" PRIMARY KEY("account_id","provider")
);
--> statement-breakpoint
ALTER TABLE "provider_credential_keys" ADD CONSTRAINT "provider_credential_keys_account_id_auth_users_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_credential_keys_kek_version_index" ON "provider_credential_keys" USING btree ("kek_version");--> statement-breakpoint
INSERT INTO "provider_credential_keys" (
	"account_id",
	"provider",
	"version",
	"kek_version",
	"ciphertext_b64",
	"iv_b64",
	"auth_tag_b64",
	"masked_hint",
	"validation_state",
	"created_at",
	"updated_at",
	"validated_at"
)
SELECT
	"account_id",
	CASE
		WHEN "provider" IS NULL OR trim("provider") = '' THEN 'openai'
		ELSE "provider"
	END,
	"version",
	"kek_version",
	"ciphertext_b64",
	"iv_b64",
	"auth_tag_b64",
	"masked_hint",
	"validation_state",
	"created_at",
	"updated_at",
	"validated_at"
FROM "provider_credentials"
ON CONFLICT DO NOTHING;
