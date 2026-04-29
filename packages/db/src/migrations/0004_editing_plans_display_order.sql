-- Migration: add display_order column to editing_plans for user-controlled ordering.
-- Idempotent so a partial application can be retried safely (DDL auto-commits in MySQL).

DROP PROCEDURE IF EXISTS `__mig_0004`;
--> statement-breakpoint

CREATE PROCEDURE `__mig_0004`()
BEGIN
    DECLARE v_count INT DEFAULT 0;

    SELECT COUNT(*) INTO v_count FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'editing_plans' AND COLUMN_NAME = 'display_order';
    IF v_count = 0 THEN
        ALTER TABLE `editing_plans` ADD `display_order` int NOT NULL DEFAULT 0;
    END IF;
END;
--> statement-breakpoint

CALL `__mig_0004`();
--> statement-breakpoint

DROP PROCEDURE `__mig_0004`;
