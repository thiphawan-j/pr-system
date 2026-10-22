import type { PurchaseOrderDocument, PurchaseOrderDocumentElement } from "@/lib/purchase-order-document";

function DocumentElement({ element }: { element: PurchaseOrderDocumentElement }) {
  if (element.type === "text") {
    return <text
      x={element.x}
      y={element.y}
      fontSize={element.size}
      fontWeight={element.bold ? 700 : 400}
      fill={element.color ?? "#173c4b"}
      textAnchor={element.align === "right" ? "end" : element.align === "center" ? "middle" : "start"}
      xmlSpace="preserve"
    >{element.text}</text>;
  }
  if (element.type === "rect") {
    return <rect x={element.x} y={element.y} width={element.width} height={element.height} fill={element.fill ?? "none"} stroke={element.stroke ?? "none"} strokeWidth={0.6} />;
  }
  return <line x1={element.x} y1={element.y} x2={element.x2} y2={element.y2} stroke={element.color} strokeWidth={0.6} />;
}

export function PurchaseOrderDocumentPreview({ document }: { document: PurchaseOrderDocument }) {
  return (
    <article className="purchase-order-document" aria-label={document.poNumber}>
      {document.pages.map((page, index) => <svg
        key={index}
        className="purchase-order-page"
        viewBox={`0 0 ${document.width} ${document.height}`}
        width={document.width}
        height={document.height}
        role="img"
        aria-label={`${document.poNumber} · ${index + 1} / ${document.pages.length}`}
        xmlns="http://www.w3.org/2000/svg"
      >
        {page.elements.map((element, elementIndex) => <DocumentElement key={elementIndex} element={element} />)}
      </svg>)}
    </article>
  );
}
