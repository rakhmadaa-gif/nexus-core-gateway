#!/usr/bin/env python3
"""
Nexus Pull Payment — End-to-End Test Script
============================================
Tests the full EIP-712 permit → Gateway.sol → Virtual Credit flow.

Flow:
  1. Create a test wallet (random, no MATIC needed for signing)
  2. Send 0.1 USDC from Treasury to test wallet (Treasury pays gas)
  3. Test wallet signs EIP-712 permit (authorize Gateway.sol to pull 0.1 USDC)
  4. Send permit to Edge Function (service_type: "pull_payment")
  5. Edge Function calls Gateway.sol.pullPayment() on Polygon
  6. Verify credits added to client balance

Usage:
  POLYGON_PRIVATE_KEY="$POLYGON_PRIVATE_KEY" python3 nexus-e2e-test.py
"""

import os
import sys
import json
import time
import subprocess
import urllib.request

# --- Configuration ---
RPC_URL = "https://polygon-bor-rpc.publicnode.com"
GATEWAY_ADDRESS = "0xDEEc5BE05F0911b4aCD7FB6C8a4aa603C13F60e4"
USDC_ADDRESS = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"
EDGE_FUNCTION_URL = "https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world"
CLIENT_ID = "nexus-e2e-test-client"
AMOUNT_USDC_UNITS = 100000  # 0.1 USDC (6 decimals)
EXPECTED_CREDITS = 10  # 0.1 USDC × 100 CRED/USDC = 10 CRED
DEADLINE_MINUTES = 20  # 20 minutes from now (within 15-30 min buffer)

# Foundry cast path
CAST_BIN = "/root/workspace/.foundry/bin/cast"

def log(step, msg, detail=None):
    print(f"\n{'='*60}")
    print(f"  STEP {step}: {msg}")
    print(f"{'='*60}")
    if detail:
        print(f"  {detail}")

def cast_call(*args):
    """Run cast call and return stripped output (number only, no [1e5] suffix)"""
    cmd = [CAST_BIN, "call", *args, "--rpc-url", RPC_URL]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"cast call failed: {result.stderr}")
    raw = result.stdout.strip()
    # cast outputs like "100000 [1e5]" — extract just the number
    if " [" in raw:
        raw = raw.split(" [")[0]
    return raw

def cast_send(*args):
    """Run cast send with Treasury private key from env"""
    pk = os.environ.get("POLYGON_PRIVATE_KEY", "")
    if not pk:
        raise RuntimeError("POLYGON_PRIVATE_KEY not set in environment")
    cmd = [CAST_BIN, "send", *args, "--rpc-url", RPC_URL, "--private-key", pk]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"cast send failed: {result.stderr}")
    return result.stdout.strip()

def cast_keccak(data):
    """Compute keccak256 using cast"""
    cmd = [CAST_BIN, "keccak", data]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"cast keccak failed: {result.stderr}")
    return result.stdout.strip()

def http_post(url, body, headers=None):
    """Send HTTP POST and return (status_code, response_body)"""
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    if headers:
        for k, v in headers.items():
            req.add_header(k, v)
    try:
        resp = urllib.request.urlopen(req, timeout=120)
        return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        try:
            return e.code, json.loads(body)
        except json.JSONDecodeError:
            return e.code, {"raw": body}

def sign_eip712_permit(owner_address, owner_private_key, spender_address,
                       value, nonce, deadline):
    """Sign EIP-712 Permit using eth-account"""
    from eth_account import Account
    from eth_account.messages import encode_typed_data

    typed_data = {
        "types": {
            "EIP712Domain": [
                {"name": "name", "type": "string"},
                {"name": "version", "type": "string"},
                {"name": "chainId", "type": "uint256"},
                {"name": "verifyingContract", "type": "address"},
            ],
            "Permit": [
                {"name": "owner", "type": "address"},
                {"name": "spender", "type": "address"},
                {"name": "value", "type": "uint256"},
                {"name": "nonce", "type": "uint256"},
                {"name": "deadline", "type": "uint256"},
            ],
        },
        "primaryType": "Permit",
        "domain": {
            "name": "USD Coin",
            "version": "2",
            "chainId": 137,
            "verifyingContract": USDC_ADDRESS,
        },
        "message": {
            "owner": owner_address,
            "spender": spender_address,
            "value": str(value),
            "nonce": str(nonce),
            "deadline": str(deadline),
        },
    }

    # Sign with eth-account
    signed = Account.sign_typed_data(
        private_key=owner_private_key,
        full_message=typed_data,
    )

    # Extract v, r, s
    v = signed.v
    r = hex(signed.r)
    s = hex(signed.s)

    return v, r, s

def main():
    print("\n" + "=" * 60)
    print("  NEXUS PULL PAYMENT — END-TO-END TEST")
    print("  EIP-712 Permit → Gateway.sol → Virtual Credit")
    print("=" * 60)

    # --- Step 1: Create test wallet ---
    log(1, "Create test wallet")
    from eth_account import Account
    test_account = Account.create()
    test_address = test_account.address
    test_private_key = test_account.key.hex()
    print(f"  Test wallet address: {test_address}")
    print(f"  Test wallet key:     [REDACTED]")

    # --- Step 2: Send 0.1 USDC from Treasury to test wallet ---
    log(2, f"Send 0.1 USDC from Treasury → test wallet")
    print(f"  Amount: {AMOUNT_USDC_UNITS} units (0.1 USDC)")
    print(f"  Sending transaction on Polygon...")

    tx_output = cast_send(
        USDC_ADDRESS,
        "transfer(address,uint256)(bool)",
        test_address,
        str(AMOUNT_USDC_UNITS),
    )
    print(f"  Transaction sent! Waiting for confirmation...")

    # Wait for block confirmation
    time.sleep(3)

    # Verify USDC balance of test wallet
    balance = cast_call(
        USDC_ADDRESS,
        "balanceOf(address)(uint256)",
        test_address,
    )
    print(f"  Test wallet USDC balance: {balance} units ({int(balance)/1e6} USDC)")

    if int(balance) < AMOUNT_USDC_UNITS:
        print(f"  ERROR: Balance too low! Expected >= {AMOUNT_USDC_UNITS}")
        sys.exit(1)
    print(f"  ✅ USDC received by test wallet")

    # --- Step 3: Read USDC nonce for test wallet ---
    log(3, "Read USDC permit nonce for test wallet")
    nonce = cast_call(
        USDC_ADDRESS,
        "nonces(address)(uint256)",
        test_address,
    )
    print(f"  Permit nonce: {nonce}")

    # --- Step 4: Compute deadline and client_id_hash ---
    log(4, "Compute deadline & client_id_hash")
    now = int(time.time())
    deadline = now + (DEADLINE_MINUTES * 60)
    buffer_seconds = deadline - now
    print(f"  Current time:  {now}")
    print(f"  Deadline:      {deadline} ({DEADLINE_MINUTES} min from now)")
    print(f"  Buffer:        {buffer_seconds}s (must be 900-1800s)")

    if buffer_seconds < 900 or buffer_seconds > 1800:
        print(f"  ERROR: Buffer {buffer_seconds}s outside 15-30 min range!")
        sys.exit(1)
    print(f"  ✅ Buffer within range")

    # Compute client_id_hash = keccak256(utf8bytes(CLIENT_ID))
    # Use Python's web3 for keccak
    from web3 import Web3
    client_id_hash = "0x" + Web3.keccak(text=CLIENT_ID).hex()
    print(f"  client_id_hash: {client_id_hash}")

    # --- Step 5: Sign EIP-712 permit ---
    log(5, "Sign EIP-712 Permit")
    print(f"  Owner:    {test_address}")
    print(f"  Spender:  {GATEWAY_ADDRESS} (Gateway.sol)")
    print(f"  Value:    {AMOUNT_USDC_UNITS} (0.1 USDC)")
    print(f"  Nonce:    {nonce}")
    print(f"  Deadline: {deadline}")

    v, r, s = sign_eip712_permit(
        owner_address=test_address,
        owner_private_key=test_private_key,
        spender_address=GATEWAY_ADDRESS,
        value=AMOUNT_USDC_UNITS,
        nonce=int(nonce),
        deadline=deadline,
    )
    print(f"  v: {v}")
    print(f"  r: {r}")
    print(f"  s: {s}")
    print(f"  ✅ EIP-712 permit signed")

    # --- Step 6: Send permit to Edge Function ---
    log(6, "Send pull_payment request to Edge Function")
    request_body = {
        "service_type": "pull_payment",
        "params": {
            "client_address": test_address,
            "amount_usdc": str(AMOUNT_USDC_UNITS),
            "deadline": deadline,
            "v": v,
            "r": r,
            "s": s,
            "client_id_hash": client_id_hash,
        },
    }
    print(f"  POST {EDGE_FUNCTION_URL}")
    print(f"  x-client-id: {CLIENT_ID}")
    print(f"  Body: {json.dumps(request_body, indent=2)[:500]}...")

    status, response = http_post(
        EDGE_FUNCTION_URL,
        request_body,
        headers={"x-client-id": CLIENT_ID},
    )

    print(f"\n  HTTP Status: {status}")
    print(f"  Response:")
    print(f"  {json.dumps(response, indent=2)}")

    # --- Step 7: Analyze result ---
    log(7, "Analyze result")
    resp_status = response.get("status", "unknown")
    print(f"  Response status: {resp_status}")

    if resp_status == "verified":
        payload = response.get("payload", {})
        credits = payload.get("credits_minted", 0)
        tx_hash = payload.get("tx_hash", "N/A")
        block = payload.get("block_number", "N/A")
        print(f"  ✅ SUCCESS! Pull payment verified!")
        print(f"  Credits minted: {credits} CRED")
        print(f"  TX hash:        {tx_hash}")
        print(f"  Block:          {block}")

        if credits == EXPECTED_CREDITS:
            print(f"  ✅ Credits match expected: {EXPECTED_CREDITS} CRED")
        else:
            print(f"  ⚠️  Credits mismatch: expected {EXPECTED_CREDITS}, got {credits}")

    elif resp_status == "pending":
        payload = response.get("payload", {})
        print(f"  ⏳ PENDING! 2-block confirmation in progress.")
        print(f"  TX hash: {payload.get('tx_hash', 'N/A')}")
        print(f"  Credits expected: {payload.get('credits_expected', 'N/A')}")

    elif resp_status == "failed":
        payload = response.get("payload", {})
        error_code = payload.get("error_code", "UNKNOWN")
        error_msg = payload.get("error_message", "Unknown error")
        print(f"  ❌ FAILED!")
        print(f"  Error code:    {error_code}")
        print(f"  Error message: {error_msg}")

        # Print audit trail if available
        trail = response.get("audit_trail", [])
        if trail:
            print(f"\n  Audit trail:")
            for step in trail:
                print(f"    [{step.get('status','?')}] {step.get('step','?')}: {step.get('detail','')}")

    else:
        print(f"  ⚠️  Unknown response status: {resp_status}")
        print(f"  Full response: {json.dumps(response, indent=2)}")

    # --- Summary ---
    print(f"\n{'='*60}")
    print(f"  TEST SUMMARY")
    print(f"{'='*60}")
    print(f"  Test wallet:    {test_address}")
    print(f"  Client ID:     {CLIENT_ID}")
    print(f"  Amount:        0.1 USDC ({AMOUNT_USDC_UNITS} units)")
    print(f"  Expected CRED: {EXPECTED_CREDITS}")
    print(f"  HTTP Status:   {status}")
    print(f"  Result:        {resp_status}")
    print(f"{'='*60}\n")

if __name__ == "__main__":
    main()
