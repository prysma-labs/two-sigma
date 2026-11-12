import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { formatUsdc, walletAddress, walletKey } from "../lib/wallet.ts";

const key = `0x${"11".repeat(32)}` as `0x${string}`;

test("a wallet key stays off the address result", () => {
  const address = walletAddress({ X402_PRIVATE_KEY: key });
  assert.equal(address, privateKeyToAccount(key).address);
  assert.equal(JSON.stringify({ address }).includes(key.slice(2)), false);
  assert.equal(walletKey({}), null);
});

test("usdc amounts keep two decimals", () => {
  assert.equal(formatUsdc(0n), "0.00");
  assert.equal(formatUsdc(20_000n), "0.02");
  assert.equal(formatUsdc(1_500_000n), "1.50");
});
