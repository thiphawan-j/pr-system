"use client";
import { useEffect, useRef, useState } from "react";
import { ProductCorrection, ProductAudit, type CatalogProduct } from "./product-correction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/components/i18n/i18n-provider";

type Product = CatalogProduct;
export function ProductCatalog({ canManage }: { canManage: boolean }) {
  const { locale } = useI18n(); const th = locale === "th";
  const [query, setQuery] = useState(""); const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const [page, setPage] = useState(1); const [pages, setPages] = useState(1);
  const [items, setItems] = useState<Product[]>([]); const [error, setError] = useState("");
  const [busy, setBusy] = useState(false); const saving = useRef(false); const [revision, setRevision] = useState(0);
  const [code, setCode] = useState(""); const [name, setName] = useState(""); const [unit, setUnit] = useState("");
  const [target, setTarget] = useState<Product | null>(null); const [alias, setAlias] = useState(""); const [context, setContext] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    fetch(`/api/products?query=${encodeURIComponent(search)}&page=${page}&limit=20&status=${status}`, { signal: abort.signal }).then(async r => {
      const data = await r.json(); if (!r.ok) throw new Error(data.error);
      setItems(data.items); setPages(data.totalPages || 1); setError("");
    }).catch(e => { if (!abort.signal.aborted) setError(e.message); });
    return () => abort.abort();
  }, [search, page, revision, status]);
  async function save(url: string, data: object, done: () => void) {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError("");
    try { const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      const result = await r.json(); if (!r.ok) throw new Error(result.error); done(); setRevision(n => n + 1);
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); }
    finally { saving.current = false; setBusy(false); }
  }
  return <div className="space-y-6">
    <h1 className="text-2xl font-semibold">{th ? "ทะเบียนสินค้าและชื่อเรียก" : "Product catalog and aliases"}</h1>
    <p className="text-sm text-muted-foreground">{th ? "หนึ่งรหัสต่อหนึ่งชนิดสินค้า ชื่อเรียกหลายชื่อใช้รหัสเดียวกันได้ แต่สินค้าที่แปรรูปเป็นอีกชนิดต้องใช้คนละรหัส ไม่มีการจับคู่หรือแก้เอกสารเก่าอัตโนมัติ" : "One code per distinct product. Aliases refer to the same identity; transformed products need separate codes. No automatic linking or historical document changes."}</p>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {canManage && <form className="grid gap-3 rounded-xl border p-4 sm:grid-cols-3" onSubmit={e => { e.preventDefault(); void save("/api/products", { code, name, unit }, () => { setCode(""); setName(""); setUnit(""); }); }}>
      <div><Label htmlFor="product-code">{th ? "รหัสสินค้า" : "Code"}</Label><Input id="product-code" required maxLength={64} value={code} onChange={e => setCode(e.target.value)} disabled={busy}/></div>
      <div><Label htmlFor="product-name">{th ? "ชื่อกลาง" : "Canonical name"}</Label><Input id="product-name" required maxLength={200} value={name} onChange={e => setName(e.target.value)} disabled={busy}/></div>
      <div><Label htmlFor="product-unit">{th ? "หน่วย" : "Unit"}</Label><Input id="product-unit" required maxLength={50} value={unit} onChange={e => setUnit(e.target.value)} disabled={busy}/></div>
      <Button disabled={busy} type="submit">{th ? "สร้างรหัสกลาง" : "Create product"}</Button>
    </form>}
    <form className="flex gap-2" onSubmit={e => { e.preventDefault(); setPage(1); setSearch(query); }}><Input aria-label={th ? "ค้นหารหัส ชื่อ หรือชื่อเรียก" : "Search code, name or alias"} value={query} onChange={e => setQuery(e.target.value)} maxLength={200}/><Button type="submit">{th ? "ค้นหา" : "Search"}</Button></form>
    {canManage && <label className="flex items-center gap-2 text-sm">{th ? "สถานะทะเบียน" : "Catalog status"}<select className="rounded-md border bg-background p-2" aria-label={th ? "สถานะทะเบียน" : "Catalog status"} value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="ACTIVE">{th ? "ใช้งานอยู่" : "Active"}</option><option value="INACTIVE">{th ? "ปิดใช้งานแล้ว" : "Inactive"}</option><option value="ALL">{th ? "ทั้งหมด" : "All"}</option></select></label>}
    <div className="space-y-3">{items.map(item => <article key={item.id} className="space-y-2 rounded-xl border p-4"><h2 className="font-semibold">{item.code} · {item.name} ({item.unit}){!item.isActive ? (th ? " · ปิดใช้งานแล้ว" : " · Inactive") : ""}</h2><p className="break-words text-sm">{item.aliases.filter(a => a.isActive).map(a => `${a.name}${a.context ? ` (${a.context})` : ""}`).join(", ") || (th ? "ยังไม่มีชื่อเรียกอื่น" : "No aliases")}</p>{canManage && item.isActive && <Button type="button" variant="outline" disabled={busy} onClick={() => { setTarget(item); setAlias(""); setContext(""); setConfirmed(false); }}>{th ? "เพิ่มชื่อเรียก" : "Add alias"}</Button>}{canManage && <><ProductCorrection product={item} onSaved={() => { setRevision(n => n + 1); setTarget(null); }} /><ProductAudit productId={item.id} revision={revision} /></>}</article>)}</div>
    {target && <form className="space-y-3 rounded-xl border border-blue-500 p-4" onSubmit={e => { e.preventDefault(); void save(`/api/products/${target.id}/aliases`, { name: alias, context, confirmed }, () => setTarget(null)); }}>
      <h2>{th ? "เพิ่มชื่อเรียกให้" : "Add alias for"} {target.code} · {target.name} ({target.unit})</h2>
      <Label htmlFor="alias-name">{th ? "ชื่อเรียกอื่น" : "Alias"}</Label><Input id="alias-name" required maxLength={200} value={alias} onChange={e => { setAlias(e.target.value); setConfirmed(false); }} disabled={busy}/>
      <Label htmlFor="alias-context">{th ? "แผนก / บริบท (ถ้ามี)" : "Department / context (optional)"}</Label><Input id="alias-context" maxLength={100} value={context} onChange={e => { setContext(e.target.value); setConfirmed(false); }} disabled={busy}/>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={busy}/>{th ? `ยืนยันว่า “${alias}” คือสินค้าเดียวกับ ${target.code} ไม่ใช่สินค้าที่ได้หลังแปรรูป` : `I confirm “${alias}” is the same product as ${target.code}, not a transformed product.`}</label>
      <div className="flex gap-2"><Button type="submit" disabled={busy || !confirmed}>{th ? "บันทึกชื่อเรียก" : "Save alias"}</Button><Button type="button" variant="outline" disabled={busy} onClick={() => setTarget(null)}>{th ? "ยกเลิก" : "Cancel"}</Button></div>
    </form>}
    <div className="flex items-center gap-3"><Button variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{th ? "ก่อนหน้า" : "Previous"}</Button><span>{page} / {pages}</span><Button variant="outline" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>{th ? "ถัดไป" : "Next"}</Button></div>
  </div>;
}
