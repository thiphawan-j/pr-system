"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SupplierDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

type SupplierComboboxProps = {
  id: string;
  value: string;
  selectedSupplierId?: string;
  suppliers: SupplierDetail[];
  disabled?: boolean;
  invalid?: boolean;
  inputRef?: (element: HTMLInputElement | null) => void;
  onChange: (value: string) => void;
  onSelect: (supplier: SupplierDetail) => void;
  onCompositionChange?: (composing: boolean) => void;
};

function normalize(value: string) {
  return value.normalize("NFKC").trim().toLowerCase();
}

export function SupplierCombobox({
  id, value, selectedSupplierId, suppliers, disabled, invalid, inputRef, onChange, onSelect, onCompositionChange,
}: SupplierComboboxProps) {
  const { dictionary } = useI18n();
  const labels = dictionary.suppliers;
  const rootRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const selected = suppliers.find((supplier) => supplier.id === selectedSupplierId && supplier.isActive);
  const unavailable = Boolean(selectedSupplierId && !selected);
  const query = normalize(value);
  const matches = suppliers.filter((supplier) => supplier.isActive && (
    !query || [supplier.name, supplier.code, supplier.taxId ?? "", supplier.contactPerson ?? "", ...supplier.contacts.map((contact) => contact.value)]
      .some((field) => normalize(field).includes(query))
  ));
  const options = [
    ...matches.map((supplier) => ({ id: `${id}-option-${supplier.id}`, supplier })),
    ...(value.trim() ? [{ id: `${id}-manual`, supplier: null }] : []),
  ];
  const expanded = isOpen && !disabled;
  const activeOption = expanded ? options[activeIndex] : undefined;
  const activeId = activeOption?.id;

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  useEffect(() => {
    if (!expanded) return;
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setIsOpen(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [expanded]);

  function choose(index: number) {
    const option = options[index];
    if (!option || disabled || composingRef.current) return;
    if (option.supplier) onSelect(option.supplier);
    else onChange(value.trim());
    setIsOpen(false);
    setActiveIndex(-1);
    fieldRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (composingRef.current || event.nativeEvent.isComposing) {
      return;
    }
    // Some IMEs send their final Enter after compositionend with keyCode 229.
    // Composition has committed, but this Enter must not issue the PO.
    if (event.keyCode === 229) {
      if (event.key === "Enter") event.preventDefault();
      return;
    }
    const hasModifier = event.altKey || event.ctrlKey || event.metaKey;
    if (hasModifier && event.key !== "Enter") return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setIsOpen(true);
      if (!options.length) { setActiveIndex(-1); return; }
      const first = event.key === "ArrowDown" ? 0 : options.length - 1;
      setActiveIndex((current) => !expanded || current < 0 || current >= options.length
        ? first
        : (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
    } else if (expanded && activeIndex >= 0 && (event.key === "Home" || event.key === "End")) {
      event.preventDefault();
      setActiveIndex(options.length ? (event.key === "Home" ? 0 : options.length - 1) : -1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (!hasModifier && expanded && activeOption) choose(activeIndex);
    } else if (event.key === "Escape" && expanded) {
      event.preventDefault();
      event.stopPropagation();
      setIsOpen(false);
      setActiveIndex(-1);
    } else if (event.key === "Tab") {
      setIsOpen(false);
      setActiveIndex(-1);
    }
  }

  return (
    <div ref={rootRef} className="relative space-y-2" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) { setIsOpen(false); setActiveIndex(-1); }
    }}>
      <Input
        ref={(element) => { fieldRef.current = element; inputRef?.(element); }}
        id={id}
        role="combobox"
        required
        maxLength={200}
        autoComplete="off"
        disabled={disabled}
        aria-invalid={invalid || unavailable}
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={expanded ? `${id}-listbox` : undefined}
        aria-activedescendant={activeOption?.id}
        aria-describedby={`${id}-hint${selectedSupplierId ? ` ${id}-selection` : ""}`}
        value={value}
        placeholder={labels.comboboxPlaceholder}
        onFocus={() => { setIsOpen(true); setActiveIndex(-1); }}
        onClick={() => setIsOpen(true)}
        onChange={(event) => { onChange(event.target.value); setIsOpen(true); setActiveIndex(-1); }}
        onKeyDown={handleKeyDown}
        onCompositionStart={() => { composingRef.current = true; onCompositionChange?.(true); }}
        onCompositionEnd={() => { composingRef.current = false; onCompositionChange?.(false); }}
      />
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">{labels.comboboxHint}</p>
      {selectedSupplierId ? <div className="flex flex-wrap items-center gap-2 text-xs">
        <p id={`${id}-selection`} className={unavailable ? "text-destructive" : "text-muted-foreground"}>{selected ? `${labels.selected}: ${selected.code}` : labels.unavailable}</p>
        <Button id={`${id}-clear`} type="button" size="xs" variant="ghost" disabled={disabled} onPointerDown={(event) => event.preventDefault()} onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(""); setIsOpen(true); setActiveIndex(-1); fieldRef.current?.focus(); }}>{labels.clearSelection}</Button>
      </div> : null}
      {expanded ? <div id={`${id}-listbox`} role="listbox" aria-label={labels.matches} className="absolute top-full right-0 left-0 z-30 mt-1 max-h-64 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-lg">
        {!matches.length ? <p role="status" className="px-3 py-2 text-sm text-muted-foreground">{labels.noMatches}</p> : null}
        {options.map((option, index) => <div
          key={option.id}
          id={option.id}
          role="option"
          aria-selected={index === activeIndex}
          data-supplier-id={option.supplier?.id}
          className={cn("cursor-pointer rounded-lg px-3 py-2 text-sm break-words", index === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/60")}
          onPointerDown={(event) => event.preventDefault()}
          onMouseDown={(event) => event.preventDefault()}
          onMouseMove={() => setActiveIndex(index)}
          onClick={() => choose(index)}
        >{option.supplier ? `${option.supplier.code} · ${option.supplier.name}` : labels.useManualName}</div>)}
      </div> : null}
    </div>
  );
}
