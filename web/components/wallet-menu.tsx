"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Wallet = { address: string | null; usdc: string | null };

export function WalletMenu() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancel = false;
    async function load() {
      const response = await fetch("/api/wallet", { cache: "no-store" });
      if (!response.ok || cancel) return;
      const data = (await response.json()) as Wallet;
      if (!cancel) setWallet(data);
    }
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => {
      cancel = true;
      clearInterval(timer);
    };
  }, []);

  function copy(address: string) {
    const field = document.createElement("textarea");
    field.value = address;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.left = "-9999px";
    document.body.appendChild(field);
    field.focus();
    field.select();
    const ok = document.execCommand("copy");
    field.remove();
    if (!ok) {
      void navigator.clipboard.writeText(address).then(
        () => setCopied(true),
        () => setCopied(false),
      );
      return;
    }
    setCopied(true);
  }

  const label = wallet?.usdc == null ? "— USDC" : `${wallet.usdc} USDC`;

  return (
    <DropdownMenu onOpenChange={(open) => { if (!open) setCopied(false); }}>
      <DropdownMenuTrigger aria-label="Wallet balance" render={<Button variant="noShadow" />}>
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {wallet?.address ? (
          <DropdownMenuItem closeOnClick={false} onClick={() => copy(wallet.address!)}>
            <span>{wallet.address}</span>
            <DropdownMenuShortcut>{copied ? "Copied" : "Copy"}</DropdownMenuShortcut>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled>No wallet</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
