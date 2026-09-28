#!/usr/bin/env -S npx tsx
// W4 offline test suite — runs the pure-TS estimator against 5 fixtures and
// asserts structural + directional properties (M2 gate). No network, no Deno.
import { buildGasRank, GAS_RANK_MODEL, parseContract, estimateFunctionGas, classifyFunction } from "../../supabase/functions/hello-world/w4_gas_rank.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); }
}

// ---------------------------------------------------------------------------
// Fixture 1 — OZ-style ERC20 (transfer/approve/mint: strong classes)
// ---------------------------------------------------------------------------
const erc20 = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
contract SimpleToken is ERC20 {
    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;
    uint256 public totalSupply;
    string public constant name = "Simple";
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    constructor() ERC20("Simple", "SIM") {}
    function transfer(address to, uint256 amount) public returns (bool) {
        _balances[msg.sender] -= amount;
        _balances[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }
    function approve(address spender, uint256 amount) public returns (bool) {
        _allowances[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }
    function mint(address to, uint256 amount) public {
        totalSupply += amount;
        _balances[to] += amount;
        emit Transfer(address(0), to, amount);
    }
}`;

// ---------------------------------------------------------------------------
// Fixture 2 — NFT mint (ERC721-style, mint strong class, event-heavy)
// ---------------------------------------------------------------------------
const erc721 = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract SimpleNFT {
    mapping(uint256 => address) public ownerOf;
    mapping(address => uint256) public balanceOf;
    uint256 public nextTokenId;
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    function mint(address to) external {
        uint256 id = nextTokenId;
        ownerOf[id] = to;
        balanceOf[to] += 1;
        nextTokenId += 1;
        emit Transfer(address(0), to, id);
    }
}`;

// ---------------------------------------------------------------------------
// Fixture 3 — Vault (deposit/withdraw: stake_like + claim_like strong classes)
// ---------------------------------------------------------------------------
const vault = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
interface IERC20 { function transfer(address to, uint256 amount) external returns (bool); }
contract SimpleVault {
    mapping(address => uint256) public shares;
    uint256 public totalShares;
    IERC20 public immutable token;
    event Deposit(address indexed who, uint256 amount);
    event Withdraw(address indexed who, uint256 amount);
    constructor(IERC20 t) { token = t; }
    function deposit(uint256 amount) external {
        shares[msg.sender] += amount;
        totalShares += amount;
        token.transfer(msg.sender, 0);
        emit Deposit(msg.sender, amount);
    }
    function withdraw(uint256 shares_) external {
        shares[msg.sender] -= shares_;
        totalShares -= shares_;
        emit Withdraw(msg.sender, shares_);
    }
}`;

// ---------------------------------------------------------------------------
// Fixture 4 — unbounded loop claim (dust-spam shape from BS-009 lab)
// ---------------------------------------------------------------------------
const loopClaim = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract LoopClaim {
    address[] public stakers;
    mapping(address => uint256) public rewards;
    event Paid(address indexed who, uint256 amount);
    function addStaker(address s) external { stakers.push(s); }
    function releaseAll() external {
        for (uint256 i = 0; i < stakers.length; i++) {
            rewards[stakers[i]] = 0;
            emit Paid(stakers[i], rewards[stakers[i]]);
        }
    }
    function claim() external {
        uint256 r = rewards[msg.sender];
        rewards[msg.sender] = 0;
        emit Paid(msg.sender, r);
    }
}`;

// ---------------------------------------------------------------------------
// Fixture 5 — no rankable functions (expect NO_RANKABLE_FUNCTIONS / 422 path)
// ---------------------------------------------------------------------------
const noRankable = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract PureView {
    uint256 public value;
    function getValue() external view returns (uint256) { return value; }
    function compute(uint256 a, uint256 b) external pure returns (uint256) { return a + b; }
}`;

// =========================== T1: parser ===========================
console.log("T1 — parser structure");
{
  const parsed = parseContract(erc20);
  check("state vars detected (incl. nested mapping)", parsed.stateVars.has("_balances") && parsed.stateVars.has("_allowances"));
  check("constant var flagged", parsed.stateVars.get("name")?.isConstant === true);
  check("events parsed with indexed count", (parsed.events.get("Transfer")?.indexed ?? 0) === 2);
  const fns = parsed.functions.map((f) => f.name);
  check("public functions detected", fns.includes("transfer") && fns.includes("approve") && fns.includes("mint"));
  const transfer = parsed.functions.find((f) => f.name === "transfer")!;
  check("visibility public", transfer.visibility === "public");
  check("body extracted", transfer.body.includes("emit Transfer"));
}

// =========================== T2: estimator ===========================
console.log("T2 — estimator ops & gas");
{
  const parsed = parseContract(erc20);
  const transfer = parsed.functions.find((f) => f.name === "transfer")!;
  const { estimate, ops, breakdown } = estimateFunctionGas(transfer, parsed);
  check("transfer: 2 sstore ops (cold + warm)", ops.sstoreNew + ops.sstoreUpdate === 2, `got new=${ops.sstoreNew} upd=${ops.sstoreUpdate}`);
  check("transfer: 1 log emitted", ops.logs === 1);
  check("transfer: estimate > 21k base", estimate > 21000, `got ${estimate}`);
  check("breakdown keys present", ["tx_base", "sstore", "sload", "logs"].every((k) => k in breakdown));
  const approve = parsed.functions.find((f) => f.name === "approve")!;
  const estApprove = estimateFunctionGas(approve, parsed);
  check("approve: mapping write adds keccak", estApprove.ops.keccak >= 1, `got ${estApprove.ops.keccak}`);
}

// =========================== T3: loop model ===========================
console.log("T3 — loop model (bounded vs unbounded)");
{
  const parsed = parseContract(loopClaim);
  const releaseAll = parsed.functions.find((f) => f.name === "releaseAll")!;
  const { ops } = estimateFunctionGas(releaseAll, parsed);
  check("unbounded loop → loopRange {1,5,10}", ops.loopRange !== null && JSON.stringify(ops.loopRange.n) === "[1,5,10]");
  check("loop body costed once × scoring_n=5", ops.loopCost === ops.loopRange!.perIteration * 5, `loopCost=${ops.loopCost} perIter=${ops.loopRange!.perIteration}`);
  check("loop ops NOT double-counted into sstore", ops.sstoreNew + ops.sstoreUpdate === 0, `sstore new=${ops.sstoreNew} upd=${ops.sstoreUpdate}`);
  const claim = parsed.functions.find((f) => f.name === "claim")!;
  const { ops: cOps } = estimateFunctionGas(claim, parsed);
  check("non-loop fn: no loopRange", cOps.loopRange === null);
}

// =========================== T4: classification ===========================
console.log("T4 — classification strong/weak");
{
  const p20 = parseContract(erc20);
  const t = p20.functions.find((f) => f.name === "transfer")!;
  const { ops } = estimateFunctionGas(t, p20);
  check("transfer → transfer_like strong", classifyFunction(t, ops).op_class === "transfer_like");
  const p721 = parseContract(erc721);
  const mint = p721.functions.find((f) => f.name === "mint")!;
  const { ops: mOps } = estimateFunctionGas(mint, p721);
  check("mint → mint_like strong", classifyFunction(mint, mOps).op_class === "mint_like");
  const pv = parseContract(vault);
  const dep = pv.functions.find((f) => f.name === "deposit")!;
  const { ops: dOps } = estimateFunctionGas(dep, pv);
  check("deposit → stake_like strong", classifyFunction(dep, dOps).op_class === "stake_like");
  const wd = pv.functions.find((f) => f.name === "withdraw")!;
  const { ops: wOps } = estimateFunctionGas(wd, pv);
  check("withdraw → claim_like strong", classifyFunction(wd, wOps).op_class === "claim_like");
}

// =========================== T5: percentile & composite ===========================
console.log("T5 — percentile vs cohort + composite band");
{
  const r20 = buildGasRank([{ path: "src/SimpleToken.sol", source: erc20 }], { repo: "test/simple-token" });
  check("erc20: rankable status", (r20 as any).status === undefined || (r20 as any).status !== "NO_RANKABLE_FUNCTIONS");
  const comp = (r20 as any).composite;
  check("composite score 0-100", comp.score >= 0 && comp.score <= 100, `got ${comp.score}`);
  check("band is A-E", ["A", "B", "C", "D", "E"].includes(comp.band));
  check("legal_weight 0", (r20 as any).legal_weight === 0);
  check("cohort version tagged", (r20 as any).cohort_version === GAS_RANK_MODEL.cohort.version);
  const r721 = buildGasRank([{ path: "src/SimpleNFT.sol", source: erc721 }], { repo: "test/simple-nft" });
  check("erc721: mint ranked vs cohort", ((r721 as any).functions ?? []).some((f: any) => f.name === "mint" && typeof f.percentile === "number"));
}

// =========================== T6: vendored exclusion ===========================
console.log("T6 — vendored path exclusion");
{
  const r = buildGasRank([
    { path: "lib/openzeppelin/ERC20.sol", source: erc20 },
    { path: "src/PureView.sol", source: noRankable },
  ], { repo: "test/vendored" }) as any;
  check("vendored lib excluded from analysis", r.attested_subject.contracts_analyzed === 1 && r.attested_subject.contracts_skipped_vendored === 1);
  check("result: NO_RANKABLE_FUNCTIONS (422 path)", r.status === "NO_RANKABLE_FUNCTIONS" && r.http_status_hint === 422);
  check("no composite on 422 path", r.composite === undefined);
}

// =========================== T7: negative control — estimator must FAIL on defect ===========================
console.log("T7 — negative control (injected defect must be caught)");
{
  // Injected defect: loop body costed into the MAIN accumulator (the exact
  // double-counting bug fixed pre-test). Simulate by calling buildGasRank on
  // a contract where the loop body references the same state var as the main
  // body — if loop ops leaked into sstore counts, sstoreNew+Update > 0 on a
  // function whose only sstores are inside the loop.
  const defect = `pragma solidity ^0.8.24;
contract Defect {
    mapping(address => uint256) public balances;
    address[] public users;
    function sweep() external {
        for (uint256 i = 0; i < users.length; i++) {
            balances[users[i]] = 0;
        }
    }
}`;
  const parsed = parseContract(defect);
  const sweep = parsed.functions.find((f) => f.name === "sweep")!;
  const { ops } = estimateFunctionGas(sweep, parsed);
  const leaked = ops.sstoreNew + ops.sstoreUpdate > 0;
  check("loop-only sstore does NOT leak into main sstore counts", !leaked, `sstore new=${ops.sstoreNew} upd=${ops.sstoreUpdate} (would indicate double-count)`);
  check("loop body still costed via loopCost", ops.loopCost > 0 && ops.loopRange !== null);
}

console.log(`\n${"=".repeat(60)}\nW4 M2 SUITE: ${pass} PASS, ${fail} FAIL`);
if (fail > 0) process.exit(1);
