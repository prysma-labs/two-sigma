import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "cn"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "flex h-10 w-full min-w-0 rounded-base border-2 border-border bg-secondary-background px-3 py-2 text-sm font-base text-foreground shadow-shadow outline-none selection:bg-main selection:text-main-foreground file:border-0 file:bg-transparent file:text-sm file:font-base placeholder:text-foreground/50 focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Input }
