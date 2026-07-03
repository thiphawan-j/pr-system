"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type PasswordInputProps = Omit<React.ComponentProps<typeof Input>, "type"> & {
  containerClassName?: string;
  leadingIcon?: React.ReactNode;
  hidePasswordLabel: string;
  showPasswordLabel: string;
};

export function PasswordInput({
  className,
  containerClassName,
  leadingIcon,
  hidePasswordLabel,
  showPasswordLabel,
  ...props
}: PasswordInputProps) {
  const [isVisible, setIsVisible] = React.useState(false);

  return (
    <div className={cn("relative", containerClassName)}>
      {leadingIcon ? (
        <div className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">
          {leadingIcon}
        </div>
      ) : null}
      <Input
        type={isVisible ? "text" : "password"}
        className={cn(leadingIcon ? "pl-9" : undefined, "pr-10", className)}
        {...props}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute top-1/2 right-1 -translate-y-1/2 rounded-full text-muted-foreground hover:text-foreground"
        aria-label={isVisible ? hidePasswordLabel : showPasswordLabel}
        aria-pressed={isVisible}
        disabled={props.disabled}
        onClick={() => setIsVisible((current) => !current)}
      >
        {isVisible ? <EyeOff /> : <Eye />}
      </Button>
    </div>
  );
}
