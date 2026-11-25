const assert = require('assert');

class MockSupabase {
  constructor() {
    this.rules = new Map();
    this.incidents = [];
  }

  from(table) {
    const self = this;
    if (table === "cookie_jar_rules") {
      return {
        select: (_cols) => ({
          eq: (col, val) => ({
            single: async () => {
              if (col === "client_id" && self.rules.has(val)) {
                return { data: self.rules.get(val), error: null };
              }
              return { data: null, error: { message: "Not found" } };
            },
          }),
        }),
        insert: (record) => ({
          select: () => ({
            single: async () => {
              self.rules.set(record.client_id, record);
              return { data: record, error: null };
            },
          }),
        }),
        update: (fields) => ({
          eq: async (col, val) => {
            if (col === "client_id" && self.rules.has(val)) {
              const existing = self.rules.get(val);
              self.rules.set(val, { ...existing, ...fields });
              return { data: self.rules.get(val), error: null };
            }
            return { data: null, error: { message: "Not found" } };
          },
        }),
      };
    } else if (table === "cookie_jar_incidents") {
      return {
        insert: async (incident) => {
          self.incidents.push(incident);
          return { data: incident, error: null };
        },
      };
    }
    return {};
  }
}

async function evaluateCookieJarMock(supabase, clientId, costCredits, serviceType) {
  const todayStr = new Date().toISOString().split("T")[0];
  let { data: rule, error } = await supabase.from("cookie_jar_rules").select("*").eq("client_id", clientId).single();

  if (error || !rule) {
    const newRule = {
      client_id: clientId,
      max_daily_credits: 100.00,
      current_spent: 0.00,
      kill_switch_active: false,
      last_reset_date: todayStr,
    };
    await supabase.from("cookie_jar_rules").insert(newRule).select().single();
    rule = newRule;
  }

  if (rule.kill_switch_active) {
    return { allowed: false, statusCode: 429, errorCode: "KILL_SWITCH_TRIPPED" };
  }

  const projectedSpent = Number(rule.current_spent) + Number(costCredits);
  const ceiling = Number(rule.max_daily_credits);

  if (projectedSpent > ceiling) {
    await supabase.from("cookie_jar_rules").update({ kill_switch_active: true, current_spent: projectedSpent }).eq("client_id", clientId);
    await supabase.from("cookie_jar_incidents").insert({ client_id: clientId, reason: "Exceeded ceiling", spent_at_trigger: projectedSpent, ceiling_limit: ceiling });
    return { allowed: false, statusCode: 402, errorCode: "COOKIE_JAR_EXHAUSTED" };
  }

  // Update spent on success
  await supabase.from("cookie_jar_rules").update({ current_spent: projectedSpent }).eq("client_id", clientId);

  const remaining = ceiling - projectedSpent;
  return { allowed: true, statusCode: 200, remainingCredits: remaining };
}

async function runTests() {
  const db = new MockSupabase();
  const res1 = await evaluateCookieJarMock(db, "client_alpha", 20, "fitness");
  assert.strictEqual(res1.allowed, true);
  assert.strictEqual(res1.remainingCredits, 80);

  // Exhaust budget (spent 100)
  const resExhaust = await evaluateCookieJarMock(db, "client_beta", 100, "deep");
  assert.strictEqual(resExhaust.allowed, true);

  // Next request (10 credits) exceeds 100 ceiling -> 402
  const res2 = await evaluateCookieJarMock(db, "client_beta", 10, "deep");
  assert.strictEqual(res2.allowed, false);
  assert.strictEqual(res2.statusCode, 402);
  assert.strictEqual(res2.errorCode, "COOKIE_JAR_EXHAUSTED");

  // Subsequent request hits 429 kill-switch
  const res3 = await evaluateCookieJarMock(db, "client_beta", 5, "deep");
  assert.strictEqual(res3.allowed, false);
  assert.strictEqual(res3.statusCode, 429);
  assert.strictEqual(res3.errorCode, "KILL_SWITCH_TRIPPED");

  console.log("ALL COOKIE-JAR GUARDIAN JS TESTS PASSED SUCCESSFULLY (3/3).");
}

runTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
