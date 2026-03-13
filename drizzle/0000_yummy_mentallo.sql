CREATE TABLE `anthropic_key_pool` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`anthropic_key_id` text NOT NULL,
	`key_hint` text,
	`assigned_to` text,
	`assigned_at` text,
	`status` text DEFAULT 'available' NOT NULL,
	FOREIGN KEY (`assigned_to`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `anthropic_key_pool_anthropic_key_id_unique` ON `anthropic_key_pool` (`anthropic_key_id`);--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_key_id` text,
	`provider_project_id` text,
	`key_hint` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`disabled_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`scope_id` text,
	`monthly_limit_usd` real NOT NULL,
	`alert_threshold_pct` integer DEFAULT 80 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cost_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`date` text NOT NULL,
	`user_id` text,
	`model` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`cost_usd` real NOT NULL,
	`raw_data` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`oidc_sub` text NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`role` text DEFAULT 'user' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_oidc_sub_unique` ON `users` (`oidc_sub`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);