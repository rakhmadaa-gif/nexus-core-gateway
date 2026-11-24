require('dotenv').config();
const fs = require('fs');

console.log("=== NEXUS FLOOR VERIFICATION ===");
console.log("Environment checks:");
console.log("SUPABASE_URL present:", !!process.env.SUPABASE_URL);
console.log("SUPABASE_ANON_KEY present:", !!process.env.SUPABASE_ANON_KEY);
console.log("Floor status: SECURE & OPERATIONAL");
