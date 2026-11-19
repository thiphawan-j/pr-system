import { ProductCatalog } from "@/components/products/product-catalog";
import { requireSession } from "@/server/auth/session";
export default async function ProductsPage() {
  const session = await requireSession();
  return <ProductCatalog canManage={session.role === "ADMIN" || session.role === "PURCHASING"} />;
}
