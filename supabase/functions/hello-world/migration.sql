-- Migration: Add tiered trial columns to client_usage
-- Run in Supabase SQL Editor before deploying

ALTER TABLE client_usage
  ADD COLUMN IF NOT EXISTS code_modules_trial_used BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS trial_expires_at TIMESTAMPTZ;
