import { usdcBalance, walletAddress } from "@/lib/wallet";

export async function GET() {
  try {
    const address = walletAddress();
    if (!address) return Response.json({ address: null, usdc: null });
    const usdc = await usdcBalance(address);
    return Response.json({ address, usdc });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read the wallet.";
    return Response.json({ error: message }, { status: 500 });
  }
}
