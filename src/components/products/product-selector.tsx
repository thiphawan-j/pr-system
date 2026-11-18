"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useI18n } from "@/components/i18n/i18n-provider";

type Product = { id: string; code: string; name: string; unit: string; aliases: { name: string; context?: string | null }[] };
export function ProductSelector({ name, value, label, disabled, onChange }: {
  name: string; value?: string | null; label?: string | null; disabled?: boolean;
  onChange: (product: Product | null) => void;
}) {
  const { locale } = useI18n();
  const th = locale === "th";
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Product[]>([]);
  const [selected, setSelected] = useState<Product | null>(null);
  const [confirmedProduct, setConfirmedProduct] = useState<Product | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const sequence = useRef(0);
  async function search() {
    const version = ++sequence.current;
    setLoading(true); setError(""); setSelected(null);
    try {
      const res = await fetch(`/api/products?query=${encodeURIComponent(query)}&limit=20`);
      const data = await res.json();
      if (version !== sequence.current) return;
      if (!res.ok) throw new Error(data.error);
      setItems(data.items);
    } catch (e) { if (version === sequence.current) setError(e instanceof Error ? e.message : "Search failed"); }
    finally { if (version === sequence.current) setLoading(false); }
  }
  return <div className="space-y-2 text-xs">
    <p>{value ? `${th ? "รหัสกลาง" : "Product"}: ${confirmedProduct?.id === value ? confirmedProduct.code : label ?? value}` : (th ? "ยังไม่ผูกรหัสกลาง (ใช้ชื่อเดิมได้)" : "No catalog link (free text allowed)")}</p>
    <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => { setQuery(name); setItems([]); setSelected(null); setError(""); setOpen(true); }}>{th ? "ค้นหารหัส / ชื่อเรียก" : "Find code / alias"}</Button>{value && <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onChange(null)}>{th ? "ยกเลิกการผูก" : "Unlink"}</Button>}</div>
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) { ++sequence.current; setLoading(false); } }}><DialogContent className="max-h-[85dvh] overflow-y-auto"><DialogHeader><DialogTitle>{th ? "เลือกสินค้าจากทะเบียนกลาง" : "Select catalog product"}</DialogTitle><DialogDescription>{th ? "ตรวจชนิด ขนาด และหน่วยให้ตรงกัน ระบบไม่จับคู่เอง และไม่แก้ชื่อในเอกสาร" : "Verify specification and unit. No automatic matching or document renaming."}</DialogDescription></DialogHeader>
      <div className="flex gap-2"><Input aria-label={th ? "ค้นหาสินค้า" : "Search products"} value={query} onChange={e => setQuery(e.target.value)} /><Button type="button" disabled={loading} onClick={search}>{loading ? "…" : th ? "ค้นหา" : "Search"}</Button></div>
      {error && <p role="alert">{error}</p>}
      <p className="text-xs text-muted-foreground">{th ? "แสดงไม่เกิน 20 รายการ กรุณาระบุคำค้นให้เฉพาะเจาะจง" : "Up to 20 results. Refine your search if needed."}</p>
      <div className="space-y-2">{items.map(item => <Button key={item.id} type="button" variant={selected?.id === item.id ? "secondary" : "outline"} className="h-auto w-full justify-start whitespace-normal p-3 text-left" onClick={() => setSelected(item)}><span>{item.code} · {item.name} · {item.unit}<br /><span className="text-xs text-muted-foreground">{item.aliases.map(a => `${a.name}${a.context ? ` (${a.context})` : ""}`).join(", ")}</span></span></Button>)}</div>
      {selected && <div className="space-y-3 rounded-lg border p-3"><p>{th ? "ยืนยันว่า" : "Confirm"} “{name}” {th ? "คือสินค้าเดียวกับ" : "is the same product as"} {selected.code} · {selected.name} ({selected.unit})</p><Button type="button" onClick={() => { setConfirmedProduct(selected); onChange(selected); setOpen(false); }}>{th ? "ยืนยันผูกรายการนี้" : "Confirm this link"}</Button></div>}
      <Link href="/products" target="_blank" className="text-sm underline">{th ? "เปิดทะเบียนสินค้าในแท็บใหม่" : "Open catalog in a new tab"}</Link>
    </DialogContent></Dialog>
  </div>;
}
