// ============================================================================
// M2M FinOps Cookie-Jar Guardian Module
// Zero-Supply API Budget Firewall & Kill-Switch
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

export interface CookieJarCheckResult {
  allowed: boolean;
  statusCode: number;
  errorCode?: string;
  errorMessage?: string;
  remainingCredits?: number;
  upsellTriggered?: boolean;
  headers: Record<string, string>;
}

export async function evaluateCookieJar(
  supabase: any,
  clientId: string,
  costCredits: number,
  serviceType: string
): Promise<CookieJarCheckResult> {
  if (!clientId || clientId === "anonymous" || clientId.startsWith("live-test") || clientId.startsWith("m2m-")) {
    // Internal or unauthenticated test clients bypass strict cookie-jar unless specified
    return {
      allowed: true,
      statusCode: 200,
      headers: {
        "X-Cookie-Jar-Status": "BYPASS_INTERNAL",
      },
    };
  }

  const todayStr = new Date().toISOString().split("T")[0];

  // Fetch or initialize rule
  let { data: rule, error } = await supabase
    .from("cookie_jar_rules")
    .select("*")
    .eq("client_id", clientId)
    .single();

  if (error || !rule) {
    // Default rule: 100 credits daily cap
    const { data: newRule, insertErr } = await supabase
      .from("cookie_jar_rules")
      .insert({
        client_id: clientId,
        max_daily_credits: 100.00,
        current_spent: 0.00,
        kill_switch_active: false,
        last_reset_date: todayStr,
      })
      .select()
      .single();

    if (!insertErr && newRule) {
      rule = newRule;
    } else {
      rule = {
        client_id: clientId,
        max_daily_credits: 100.00,
        current_spent: 0.00,
        kill_switch_active: false,
        last_reset_date: todayStr,
      };
    }
  }

  // Check daily reset
  if (rule.last_reset_date !== todayStr) {
    rule.current_spent = 0.00;
    rule.kill_switch_active = false;
    rule.upsell_notified = false;
    rule.last_reset_date = todayStr;
    
    await supabase
      .from("cookie_jar_rules")
      .update({
        current_spent: 0.00,
        kill_switch_active: false,
        upsell_notified: false,
        last_reset_date: todayStr,
        updated_at: new Date().toISOString(),
      })
      .eq("client_id", clientId);
  }

  // Check if kill-switch is already tripped
  if (rule.kill_switch_active) {
    return {
      allowed: false,
      statusCode: 429,
      errorCode: "KILL_SWITCH_TRIPPED",
      errorMessage: "Cookie-Jar Guardian: Kill-switch active due to budget exhaustion or anomalous velocity. Top-up required.",
      remainingCredits: Math.max(0, Number(rule.max_daily_credits) - Number(rule.current_spent)),
      headers: {
        "X-Cookie-Jar-Status": "KILL_SWITCH_TRIPPED",
        "X-Cookie-Jar-Remaining": "0",
      },
    };
  }

  const projectedSpent = Number(rule.current_spent) + Number(costCredits);
  const ceiling = Number(rule.max_daily_credits);

  // Check hard ceiling
  if (projectedSpent > ceiling) {
    // Trip kill switch and log incident
    await supabase
      .from("cookie_jar_rules")
      .update({
        kill_switch_active: true,
        current_spent: projectedSpent,
        updated_at: new Date().toISOString(),
      })
      .eq("client_id", clientId);

    await supabase.from("cookie_jar_incidents").insert({
      client_id: clientId,
      reason: `Hard ceiling exceeded on ${serviceType}: projected ${projectedSpent} > ceiling ${ceiling}`,
      spent_at_trigger: projectedSpent,
      ceiling_limit: ceiling,
    });

    return {
      allowed: false,
      statusCode: 402,
      errorCode: "COOKIE_JAR_EXHAUSTED",
      errorMessage: `Cookie-Jar Guardian: Daily budget ceiling reached (${ceiling} credits). Request blocked.`,
      remainingCredits: 0,
      headers: {
        "X-Cookie-Jar-Status": "EXHAUSTED",
        "X-Cookie-Jar-Remaining": "0",
        "X-Nexus-Upsell-Action": "TOP_UP_REQUIRED",
      },
    };
  }

  // Check 80% threshold upsell warning
  const usageRatio = projectedSpent / ceiling;
  const upsellTriggered = usageRatio >= 0.8 && !rule.upsell_notified;

  if (upsellTriggered) {
    await supabase
      .from("cookie_jar_rules")
      .update({ upsell_notified: true })
      .eq("client_id", clientId);
  }

  const remaining = ceiling - projectedSpent;

  return {
    allowed: true,
    statusCode: 200,
    remainingCredits: remaining,
    upsellTriggered,
    headers: {
      "X-Cookie-Jar-Status": "ACTIVE",
      "X-Cookie-Jar-Remaining": remaining.toFixed(2),
      ...(upsellTriggered ? { "X-Nexus-Upsell-Tier": "ENTERPRISE_UNLIMITED_BUFFER" } : {}),
    },
  };
}

export async function commitCookieJarSpend(
  supabase: any,
  clientId: string,
  costCredits: number
) {
  if (!clientId || clientId === "anonymous" || clientId.startsWith("live-test") || clientId.startsWith("m2m-")) {
    return;
  }

  const { data: rule } = await supabase
    .from("cookie_jar_rules")
    .select("current_spent")
    .eq("client_id", clientId)
    .single();

  if (rule) {
    const newSpent = Number(rule.current_spent) + Number(costCredits);
    await supabase
      .from("cookie_jar_rules")
      .update({
        current_spent: newSpent,
        updated_at: new Date().toISOString(),
      })
      .eq("client_id", clientId);
  }
}
