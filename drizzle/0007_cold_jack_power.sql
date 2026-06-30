ALTER TABLE `api_keys` ADD `expires_at` text;--> statement-breakpoint
ALTER TABLE `api_keys` ADD `status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `api_keys` ADD `revoked_at` text;--> statement-breakpoint
ALTER TABLE `api_keys` ADD `revocation_error` text;
