-- minimum-reader: 0001_admin_foundation.sql
CREATE TABLE `fcm_metrics_hourly` (
	`hour` integer NOT NULL,
	`platform` text NOT NULL,
	`attempted` integer DEFAULT 0 NOT NULL,
	`accepted` integer DEFAULT 0 NOT NULL,
	`permanently_rejected` integer DEFAULT 0 NOT NULL,
	`transient_failure` integer DEFAULT 0 NOT NULL,
	`latency_under_100` integer DEFAULT 0 NOT NULL,
	`latency_100_to_249` integer DEFAULT 0 NOT NULL,
	`latency_250_to_499` integer DEFAULT 0 NOT NULL,
	`latency_500_to_999` integer DEFAULT 0 NOT NULL,
	`latency_1000_to_2499` integer DEFAULT 0 NOT NULL,
	`latency_2500_to_4999` integer DEFAULT 0 NOT NULL,
	`latency_5000_to_9999` integer DEFAULT 0 NOT NULL,
	`latency_10000_or_more` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`hour`, `platform`),
	CONSTRAINT "fcm_metrics_hourly_values_check" CHECK("fcm_metrics_hourly"."hour" >= 0 AND "fcm_metrics_hourly"."hour" % 3600 = 0
        AND "fcm_metrics_hourly"."platform" IN ('android', 'ios')
        AND "fcm_metrics_hourly"."attempted" >= 0
        AND "fcm_metrics_hourly"."accepted" >= 0
        AND "fcm_metrics_hourly"."permanently_rejected" >= 0
        AND "fcm_metrics_hourly"."transient_failure" >= 0
        AND "fcm_metrics_hourly"."latency_under_100" >= 0
        AND "fcm_metrics_hourly"."latency_100_to_249" >= 0
        AND "fcm_metrics_hourly"."latency_250_to_499" >= 0
        AND "fcm_metrics_hourly"."latency_500_to_999" >= 0
        AND "fcm_metrics_hourly"."latency_1000_to_2499" >= 0
        AND "fcm_metrics_hourly"."latency_2500_to_4999" >= 0
        AND "fcm_metrics_hourly"."latency_5000_to_9999" >= 0
        AND "fcm_metrics_hourly"."latency_10000_or_more" >= 0)
);

CREATE TABLE `operation_results` (
	`kind` text PRIMARY KEY NOT NULL,
	`lease_id` text NOT NULL,
	`completed_at` integer NOT NULL,
	`outcome` text NOT NULL,
	`reason` text,
	FOREIGN KEY (`kind`) REFERENCES `operation_leases`(`kind`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "operation_results_values_check" CHECK("operation_results"."kind" IN ('firebase_validation', 'cleanup', 'backup')
        AND length("operation_results"."lease_id") BETWEEN 16 AND 128
        AND "operation_results"."completed_at" >= 0
        AND "operation_results"."outcome" IN ('succeeded', 'failed', 'outcome_unknown')
        AND ("operation_results"."reason" IS NULL OR (
          length("operation_results"."reason") BETWEEN 1 AND 64
          AND substr("operation_results"."reason", 1, 1) GLOB '[a-z]'
          AND "operation_results"."reason" NOT GLOB '*[^a-z0-9_]*'
        )))
);

CREATE TABLE `request_metrics_hourly` (
	`hour` integer PRIMARY KEY NOT NULL,
	`processed` integer DEFAULT 0 NOT NULL,
	`invalid` integer DEFAULT 0 NOT NULL,
	`rate_limited` integer DEFAULT 0 NOT NULL,
	`safety_budget_exhausted` integer DEFAULT 0 NOT NULL,
	`storage_unavailable` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "request_metrics_hourly_values_check" CHECK("request_metrics_hourly"."hour" >= 0 AND "request_metrics_hourly"."hour" % 3600 = 0
        AND "request_metrics_hourly"."processed" >= 0
        AND "request_metrics_hourly"."invalid" >= 0
        AND "request_metrics_hourly"."rate_limited" >= 0
        AND "request_metrics_hourly"."safety_budget_exhausted" >= 0
        AND "request_metrics_hourly"."storage_unavailable" >= 0)
);

CREATE TABLE `verified_backups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`issuer` text,
	`subject` text,
	FOREIGN KEY (`issuer`,`subject`) REFERENCES `operator_identities`(`issuer`,`subject`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "verified_backups_values_check" CHECK(length("verified_backups"."id") BETWEEN 16 AND 128
        AND length("verified_backups"."name") BETWEEN 1 AND 128
        AND "verified_backups"."name" NOT LIKE '%/%'
        AND "verified_backups"."name" NOT LIKE '%\%'
        AND "verified_backups"."created_at" >= 0
        AND "verified_backups"."size_bytes" > 0
        AND length("verified_backups"."sha256") = 64
        AND lower("verified_backups"."sha256") = "verified_backups"."sha256"
        AND "verified_backups"."sha256" NOT GLOB '*[^a-f0-9]*'
        AND (("verified_backups"."issuer" IS NULL AND "verified_backups"."subject" IS NULL)
          OR ("verified_backups"."issuer" IS NOT NULL AND "verified_backups"."subject" IS NOT NULL)))
);

CREATE UNIQUE INDEX `verified_backups_name_idx` ON `verified_backups` (`name`);
CREATE INDEX `verified_backups_created_idx` ON `verified_backups` (`created_at`,`id`);
CREATE INDEX `operator_audit_entries_kind_occurred_idx` ON `operator_audit_entries` (`kind`,`occurred_at`,`id`);
CREATE INDEX `operator_audit_entries_outcome_occurred_idx` ON `operator_audit_entries` (`outcome`,`occurred_at`,`id`);
CREATE INDEX `operator_audit_entries_kind_outcome_occurred_idx` ON `operator_audit_entries` (`kind`,`outcome`,`occurred_at`,`id`);
