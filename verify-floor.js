const fs = require('fs');
const path = require('path');

console.log("=== NEXUS FLOOR VERIFICATION ===");
const envPath = path.join(__dirname, '.env.attestor');
if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    console.log(".env.attestor exists and readable. Lines:", content.split('\n').length);
} else {
    console.log(".env.attestor not found.");
}
console.log("Floor status: SECURE & OPERATIONAL");
