-- =============================================================
-- Tabularis Demo — Trigger showcase (MySQL 8)
-- Database: tabularis_demo
-- Purpose: exercise the v0.11.0 trigger manager:
--   * sidebar Triggers accordion with all event/timing badges
--     (BEFORE/AFTER × INSERT/UPDATE/DELETE)
--   * Trigger Editor modal (Guided and Raw SQL tabs)
--   * View Definition / Edit / Drop context-menu flow
--
-- Triggers are dropped before recreate so the script is idempotent
-- and safe to re-run against an existing tabularis_demo database.
-- =============================================================

SET NAMES utf8mb4;

USE tabularis_demo;

-- -------------------------------------------------------------
-- Audit log: target table for the AFTER UPDATE / AFTER INSERT
-- audit triggers below.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    table_name   VARCHAR(64)  NOT NULL,
    action       VARCHAR(16)  NOT NULL,
    row_pk       VARCHAR(64),
    payload      JSON,
    occurred_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

-- -------------------------------------------------------------
-- employees: BEFORE INSERT — normalize email + force is_active=1
--            when caller leaves it NULL/0 on first hire.
-- -------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_employees_bi_normalize;

DELIMITER //
CREATE TRIGGER trg_employees_bi_normalize
BEFORE INSERT ON employees
FOR EACH ROW
BEGIN
    SET NEW.email = LOWER(TRIM(NEW.email));
    IF NEW.is_active IS NULL THEN
        SET NEW.is_active = 1;
    END IF;
END//
DELIMITER ;

-- -------------------------------------------------------------
-- employees: AFTER UPDATE — write a JSON audit row whenever the
--            salary changes, capturing old/new and the actor row.
-- -------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_employees_au_audit_salary;

DELIMITER //
CREATE TRIGGER trg_employees_au_audit_salary
AFTER UPDATE ON employees
FOR EACH ROW
BEGIN
    IF OLD.salary <> NEW.salary THEN
        INSERT INTO audit_log (table_name, action, row_pk, payload)
        VALUES (
            'employees',
            'salary_change',
            CAST(NEW.id AS CHAR),
            JSON_OBJECT(
                'employee_id', NEW.id,
                'old_salary',  OLD.salary,
                'new_salary',  NEW.salary,
                'delta',       NEW.salary - OLD.salary
            )
        );
    END IF;
END//
DELIMITER ;

-- -------------------------------------------------------------
-- employees: BEFORE DELETE — block deletion of currently-active
--            employees. Use SET is_active = 0 first.
-- -------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_employees_bd_block_active;

DELIMITER //
CREATE TRIGGER trg_employees_bd_block_active
BEFORE DELETE ON employees
FOR EACH ROW
BEGIN
    IF OLD.is_active = 1 THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Cannot delete an active employee — set is_active = 0 first.';
    END IF;
END//
DELIMITER ;

-- -------------------------------------------------------------
-- orders: AFTER INSERT — bump the customer's lifetime_value by
--         the order total.
-- -------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_orders_ai_bump_ltv;

DELIMITER //
CREATE TRIGGER trg_orders_ai_bump_ltv
AFTER INSERT ON orders
FOR EACH ROW
BEGIN
    UPDATE customers
       SET lifetime_value = lifetime_value + NEW.total
     WHERE id = NEW.customer_id;
END//
DELIMITER ;

-- -------------------------------------------------------------
-- orders: AFTER UPDATE — log status transitions to audit_log.
-- -------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_orders_au_audit_status;

DELIMITER //
CREATE TRIGGER trg_orders_au_audit_status
AFTER UPDATE ON orders
FOR EACH ROW
BEGIN
    IF OLD.status <> NEW.status THEN
        INSERT INTO audit_log (table_name, action, row_pk, payload)
        VALUES (
            'orders',
            'status_change',
            CAST(NEW.id AS CHAR),
            JSON_OBJECT(
                'order_id',   NEW.id,
                'old_status', OLD.status,
                'new_status', NEW.status
            )
        );
    END IF;
END//
DELIMITER ;

-- -------------------------------------------------------------
-- order_items: AFTER INSERT — decrement product stock by qty.
-- -------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_order_items_ai_decrement_stock;

DELIMITER //
CREATE TRIGGER trg_order_items_ai_decrement_stock
AFTER INSERT ON order_items
FOR EACH ROW
BEGIN
    UPDATE products
       SET stock = stock - NEW.quantity
     WHERE id = NEW.product_id;
END//
DELIMITER ;

-- -------------------------------------------------------------
-- order_items: AFTER DELETE — restore product stock if an item
--              row is removed (refund / order cancellation).
-- -------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_order_items_ad_restore_stock;

DELIMITER //
CREATE TRIGGER trg_order_items_ad_restore_stock
AFTER DELETE ON order_items
FOR EACH ROW
BEGIN
    UPDATE products
       SET stock = stock + OLD.quantity
     WHERE id = OLD.product_id;
END//
DELIMITER ;

-- -------------------------------------------------------------
-- products: BEFORE UPDATE — refuse to set price to zero or below.
-- -------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_products_bu_prevent_nonpositive_price;

DELIMITER //
CREATE TRIGGER trg_products_bu_prevent_nonpositive_price
BEFORE UPDATE ON products
FOR EACH ROW
BEGIN
    IF NEW.price <= 0 THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Product price must be greater than zero.';
    END IF;
END//
DELIMITER ;
