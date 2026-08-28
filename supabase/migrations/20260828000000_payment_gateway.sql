-- ============================================================================
-- NEXUS PAYMENT GATEWAY — Payment Intents + Auto-Credit (Polygon PoS USDC)
-- Rate: $1 USDC = 100 CRED
-- Method: single treasury address + unique 4-decimal amount tag per intent
-- ============================================================================

-- 1. Payment intents ------------------------------------------------------------

create table if not exists payment_intents (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  usd_amount numeric not null check (usd_amount > 0),
  tag smallint not null check (tag between 1 and 9999),
  expected_amount numeric not null,            -- usd_amount + tag/10000
  credits integer not null,                    -- usd_amount * 100
  status text not null default 'pending' check (status in ('pending','confirmed','expired')),
  deposit_address text not null,
  tx_hash text,
  from_address text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '60 minutes',
  confirmed_at timestamptz
);

-- One pending intent per tag at a time (the tag IS the client identifier on-chain)
create unique index if not exists payment_intents_pending_tag
  on payment_intents (tag) where status = 'pending';

create index if not exists payment_intents_client on payment_intents (client_id);
create index if not exists payment_intents_status on payment_intents (status);

-- 2. Confirmed payments audit ---------------------------------------------------

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  intent_id uuid references payment_intents (id),
  client_id text not null,
  tx_hash text not null unique,
  from_address text,
  usd_amount numeric not null,
  credits integer not null,
  chain text not null default 'polygon-pos',
  created_at timestamptz not null default now()
);

-- 3. Scanner cursor (last scanned block) ----------------------------------------

create table if not exists chain_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- 4. RLS: no public access; Edge Functions use service role (bypasses RLS) ------

alter table payment_intents enable row level security;
alter table payments enable row level security;
alter table chain_state enable row level security;

-- 5. Atomic confirm + credit RPC ------------------------------------------------
-- Called by the listener/scanner. Marks intent confirmed, writes payment audit
-- row, and increments client_usage.balance_credits in ONE transaction.

create or replace function confirm_payment_intent(
  p_intent_id uuid,
  p_tx_hash text,
  p_from_address text,
  p_actual_amount numeric
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_intent payment_intents%rowtype;
begin
  select * into v_intent from payment_intents where id = p_intent_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'intent_not_found');
  end if;

  if v_intent.status = 'confirmed' then
    return jsonb_build_object('ok', true, 'already', true, 'credits', v_intent.credits);
  end if;

  if v_intent.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'intent_not_pending', 'status', v_intent.status);
  end if;

  if p_actual_amount + 0.000001 < v_intent.expected_amount then
    return jsonb_build_object('ok', false, 'error', 'amount_mismatch',
      'expected', v_intent.expected_amount, 'actual', p_actual_amount);
  end if;

  update payment_intents
    set status = 'confirmed',
        tx_hash = p_tx_hash,
        from_address = p_from_address,
        confirmed_at = now()
    where id = p_intent_id;

  insert into payments (intent_id, client_id, tx_hash, from_address, usd_amount, credits)
    values (v_intent.id, v_intent.client_id, p_tx_hash, p_from_address, v_intent.usd_amount, v_intent.credits)
    on conflict (tx_hash) do nothing;

  insert into client_usage (client_id, tier, free_requests_left, balance_credits, total_invocations)
    values (v_intent.client_id, 'paid', 0, v_intent.credits, 0)
    on conflict (client_id) do update
      set balance_credits = client_usage.balance_credits + v_intent.credits,
          tier = 'paid';

  return jsonb_build_object('ok', true, 'credits', v_intent.credits, 'client_id', v_intent.client_id);
end;
$$;
