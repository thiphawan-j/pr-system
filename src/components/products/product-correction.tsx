"use client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useI18n } from "@/components/i18n/i18n-provider";
export type CatalogProduct = { id: string; code: string; name: string; unit: string; isActive: boolean; version: number; aliases: { id: string; name: string; context: string | null; isActive: boolean }[] };
type Correction = { expectedVersion?: number; originalName?: string; action: "RENAME" | "DEACTIVATE" | "ALIAS"; aliasId?: string; aliasName?: string };
export function ProductCorrection({ product, onSaved }: { product: CatalogProduct; onSaved: () => void }) {
  const { locale } = useI18n(); const th = locale === "th";
  const saving = useRef(false);
  const [edit, setEdit] = useState<Correction | null>(null); const [name, setName] = useState(product.name);
  const [reason, setReason] = useState(""); const [confirmed, setConfirmed] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  function open(value: Correction) { setEdit({ ...value, expectedVersion: product.version, originalName: product.name }); setName(product.name); setReason(""); setConfirmed(false); setError(""); }
  async function save() {
    if (!edit || saving.current) return;
    saving.current = true;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/products/${product.id}${edit.action === "ALIAS" ? `/aliases/${edit.aliasId}` : ""}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: edit.expectedVersion, reason, ...(edit.action === "ALIAS" ? {} : { action: edit.action, ...(edit.action === "RENAME" ? { name } : {}) }) }),
      });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setEdit(null); onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); }
    finally { saving.current = false; setBusy(false); }
  }
  return <div className="space-y-3">
    {product.isActive && <div className="flex flex-wrap gap-2"><Button variant="outline" type="button" onClick={() => open({ action: "RENAME" })}>{th ? "แก้ชื่อกลาง" : "Correct name"}</Button><Button variant="outline" type="button" onClick={() => open({ action: "DEACTIVATE" })}>{th ? "ปิดใช้งานสินค้า" : "Deactivate product"}</Button></div>}
    <ul className="space-y-2 text-sm">{product.aliases.map(alias => <li className="flex flex-wrap items-center gap-2" key={alias.id}><span className="break-words">{alias.name}{alias.context ? ` (${alias.context})` : ""}{!alias.isActive ? (th ? " · ปิดใช้งานแล้ว" : " · Inactive") : ""}</span>{product.isActive && alias.isActive && <Button variant="ghost" size="sm" type="button" onClick={() => open({ action: "ALIAS", aliasId: alias.id, aliasName: alias.name })}>{th ? "ปิดชื่อเรียก" : "Deactivate alias"}</Button>}</li>)}</ul>
    <Dialog open={!!edit} onOpenChange={value => { if (!value && !busy) setEdit(null); }}><DialogContent className="max-h-[85dvh] overflow-y-auto"><DialogHeader><DialogTitle>{edit?.action === "RENAME" ? (th ? "แก้ชื่อกลาง" : "Correct name") : (th ? "ยืนยันปิดใช้งาน" : "Confirm deactivation")}</DialogTitle><DialogDescription>{th ? "แก้เฉพาะทะเบียน ไม่เปลี่ยนชื่อหรือรหัสที่บันทึกในเอกสารเก่า หากเป็นสินค้าคนละชนิด ให้สร้างรหัสใหม่" : "Changes affect only the catalog, never historical document snapshots. A different product must use a new code."}</DialogDescription></DialogHeader>
      <p className="break-words">{product.code} · {edit?.aliasName ?? edit?.originalName} ({product.unit})</p>
      {edit?.action === "RENAME" && <div><Label htmlFor="correction-name">{th ? "ชื่อกลางที่ถูกต้อง" : "Corrected name"}</Label><Input id="correction-name" value={name} maxLength={200} disabled={busy} onChange={e => { setName(e.target.value); setConfirmed(false); }} /></div>}
      <div><Label htmlFor="correction-reason">{th ? "เหตุผลการแก้ไข" : "Correction reason"}</Label><Input id="correction-reason" value={reason} maxLength={1000} disabled={busy} onChange={e => setReason(e.target.value)} /></div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />{edit?.action === "RENAME" ? (th ? "ยืนยันว่าแก้การสะกดของสินค้าเดิม ไม่เปลี่ยนชนิดสินค้า" : "This corrects the same product, not its identity.") : (th ? "ยืนยันปิดใช้งานสำหรับการเลือกใหม่ โดยเก็บข้อมูลและเอกสารเก่าไว้ ไม่มีการลบหรือย้ายรหัส" : "Disable future selection while preserving existing records. No deletion or reassignment.")}</label>
      {error && <div><p role="alert" className="text-sm text-destructive">{error}</p><Button type="button" variant="outline" disabled={busy} onClick={() => { setEdit(null); onSaved(); }}>{th ? "โหลดข้อมูลล่าสุดแล้วลองใหม่" : "Reload catalog and try again"}</Button></div>}
      <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy || !confirmed || reason.trim().length < 5 || (edit?.action === "RENAME" && !name.trim())} onClick={save}>{busy ? "…" : th ? "ยืนยันบันทึกการแก้ไข" : "Confirm correction"}</Button><Button type="button" variant="outline" disabled={busy} onClick={() => setEdit(null)}>{th ? "ยกเลิก" : "Cancel"}</Button></div>
    </DialogContent></Dialog>
  </div>;
}

type Audit = { id: string; action: string; before: unknown; after: unknown; actorId: string; actorName?: string; reason: string; createdAt: string };
export function ProductAudit({ productId, revision }: { productId: string; revision: number }) {
  const { locale } = useI18n(); const th = locale === "th";
  const [open, setOpen] = useState(false); const [page, setPage] = useState(1); const [pages, setPages] = useState(1); const [items, setItems] = useState<Audit[]>([]); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function load(next: number) {
    setBusy(true); setError("");
    try { const response = await fetch(`/api/products/${productId}/audit?page=${next}&revision=${revision}`); const data = await response.json(); if (!response.ok) throw new Error(data.error); setItems(data.items); setPages(data.totalPages || 1); setPage(next); setOpen(true); }
    catch (e) { setError(e instanceof Error ? e.message : "Load failed"); } finally { setBusy(false); }
  }
  return <div className="space-y-2"><Button type="button" variant="ghost" disabled={busy} onClick={() => void load(1)}>{th ? "ดูประวัติการแก้ไข" : "View correction history"}</Button>{error && <p role="alert">{error}</p>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[85dvh] overflow-y-auto"><DialogHeader><DialogTitle>{th ? "ประวัติทะเบียนสินค้า" : "Catalog history"}</DialogTitle><DialogDescription>{th ? "ผู้ดำเนินการ เหตุผล และค่าก่อน/หลังแก้ไข" : "Actor, reason, and before/after values"}</DialogDescription></DialogHeader>
      {items.length === 0 && <p>{th ? "ยังไม่มีประวัติการแก้ไข" : "No corrections yet"}</p>}{items.map(item => <article key={item.id} className="space-y-2 rounded-lg border p-3 text-sm"><p>{item.action} · {new Date(item.createdAt).toLocaleString(locale)}</p><p>{item.actorName ?? item.actorId}</p><p>{item.reason}</p><p className="break-words">{th ? "ก่อน" : "Before"}: {JSON.stringify(item.before)}</p><p className="break-words">{th ? "หลัง" : "After"}: {JSON.stringify(item.after)}</p></article>)}
      <div className="flex items-center gap-2"><Button variant="outline" disabled={busy || page <= 1} onClick={() => void load(page - 1)}>{th ? "ก่อนหน้า" : "Previous"}</Button><span>{page}/{pages}</span><Button variant="outline" disabled={busy || page >= pages} onClick={() => void load(page + 1)}>{th ? "ถัดไป" : "Next"}</Button></div>
    </DialogContent></Dialog>
  </div>;
}
