CREATE TABLE "enterprise_copilot_api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"api_key_encrypted" text NOT NULL,
	"api_key_lookup" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "enterprise_copilot_api_keys_api_key_encrypted_hash_idx" ON "enterprise_copilot_api_keys" USING hash ("api_key_encrypted");--> statement-breakpoint
CREATE INDEX "enterprise_copilot_api_keys_lookup_hash_idx" ON "enterprise_copilot_api_keys" USING hash ("api_key_lookup");