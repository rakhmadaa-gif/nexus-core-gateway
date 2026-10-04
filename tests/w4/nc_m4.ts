import { buildGasRank } from "../../supabase/functions/hello-world/w4_gas_rank.ts";
// NC1: repo tanpa .sol
const r1 = buildGasRank([{ path: "README.md", source: "hello" }], { repo: "empty" }) as any;
console.log("NC1 no-sol:", r1.status === "NO_RANKABLE_FUNCTIONS" && r1.http_status_hint === 422 ? "✅ 422-class" : `❌ ${r1.status}`);
// NC2: vendored-only
const r2 = buildGasRank([{ path: "lib/forge-src/Vendored.sol", source: "contract VendoredToken { function transfer() external {} }" }], { repo: "vendored" }) as any;
console.log("NC2 vendored-only:", r2.status === "NO_RANKABLE_FUNCTIONS" && r2.http_status_hint === 422 ? "✅ 422-class" : `❌ ${r2.status}`);
// NC3: interface-only (no public fn bodies)
const r3 = buildGasRank([{ path: "I.sol", source: "interface IFoo { function transfer(address to, uint256 amount) external; }" }], { repo: "ifonly" }) as any;
console.log("NC3 interface-only:", r3.status === "NO_RANKABLE_FUNCTIONS" ? "✅ 422-class" : `❌ ${r3.status}`);
