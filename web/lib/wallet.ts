import { createPublicClient, formatUnits, http } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const usdcAbi = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export function walletKey(env: NodeJS.ProcessEnv = process.env) {
  const raw = env.X402_PRIVATE_KEY?.trim() ?? "";
  if (!raw) return null;
  const key = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("X402_PRIVATE_KEY must be a 32-byte hex private key.");
  return key as `0x${string}`;
}

export function walletAddress(env: NodeJS.ProcessEnv = process.env) {
  const key = walletKey(env);
  if (!key) return null;
  return privateKeyToAccount(key).address;
}

export function formatUsdc(units: bigint) {
  const [whole, frac = ""] = formatUnits(units, 6).split(".");
  const shown = frac.replace(/0+$/, "");
  return `${whole}.${shown.padEnd(2, "0")}`;
}

export async function usdcBalance(address: `0x${string}`) {
  const client = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });
  const units = await client.readContract({
    address: usdc,
    abi: usdcAbi,
    functionName: "balanceOf",
    args: [address],
  });
  return formatUsdc(units);
}
