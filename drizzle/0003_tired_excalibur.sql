ALTER TABLE `users` ADD `openai_project_id` text;--> statement-breakpoint
ALTER TABLE `api_keys` DROP COLUMN `provider_project_id`;