-- ============================================================================
-- M2M FinOps Cookie-Jar Guardian Migration
-- Table: cookie_jar_rules & cookie_jar_incidents
-- ============================================================================

CREATE TABLE IF NOT EXISTS cookie_jar_rules (
    client_id TEXT PRIMARY KEY,
    max_daily_credits NUMERIC(12,2) NOT NULL DEFAULT 100.00,
    current_spent NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    kill_switch_active BOOLEAN NOT NULL DEFAULT FALSE,
    upsell_notified BOOLEAN NOT NULL DEFAULT FALSE,
    last_reset_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cookie_jar_incidents (
    incident_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    spent_at_trigger NUMERIC(12,2) NOT NULL,
    ceiling_limit NUMERIC(12,2) NOT NULL,
    triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cookie_jar_client ON cookie_jar_rules(client_id);
CREATE INDEX IF NOT EXISTS idx_cookie_jar_incidents_client ON cookie_jar_incidents(client_id);
