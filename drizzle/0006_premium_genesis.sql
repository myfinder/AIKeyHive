CREATE TABLE `model_prices` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`input_usd_per_1m` real NOT NULL,
	`cached_input_usd_per_1m` real,
	`output_usd_per_1m` real NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `model_prices_active_provider_model_unique` ON `model_prices` (`provider`,`model`) WHERE "model_prices"."active" = 1;--> statement-breakpoint
CREATE TABLE `proxy_budget_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`proxy_key_id` text NOT NULL,
	`hour_window` text NOT NULL,
	`day_window` text NOT NULL,
	`month_window` text NOT NULL,
	`reserved_micro_usd` integer NOT NULL,
	`actual_micro_usd` integer,
	`released` integer DEFAULT 0 NOT NULL,
	`reconciled` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`proxy_key_id`) REFERENCES `proxy_keys`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `proxy_key_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`proxy_key_id` text NOT NULL,
	`provider` text NOT NULL,
	`allowed_models_json` text NOT NULL,
	`hourly_limit_usd` real NOT NULL,
	`daily_limit_usd` real NOT NULL,
	`monthly_limit_usd` real NOT NULL,
	`max_request_usd` real NOT NULL,
	`max_output_tokens` integer NOT NULL,
	`max_concurrency` integer DEFAULT 1 NOT NULL,
	`allow_tools` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`proxy_key_id`) REFERENCES `proxy_keys`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `proxy_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`key_hash` text NOT NULL,
	`key_hint` text NOT NULL,
	`upstream_project_id` text,
	`upstream_provider_key_id` text,
	`upstream_key_value` text,
	`upstream_key_hint` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`revoked_at` text,
	`last_used_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `proxy_keys_key_hash_unique` ON `proxy_keys` (`key_hash`);--> statement-breakpoint
CREATE TABLE `proxy_usage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`proxy_key_id` text NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`endpoint` text NOT NULL,
	`model` text NOT NULL,
	`status` text NOT NULL,
	`request_id` text,
	`provider_request_id` text,
	`estimated_cost_usd` real NOT NULL,
	`reserved_cost_usd` real NOT NULL,
	`actual_cost_usd` real,
	`input_tokens` integer,
	`output_tokens` integer,
	`raw_usage_json` text,
	`error_code` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`proxy_key_id`) REFERENCES `proxy_keys`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
