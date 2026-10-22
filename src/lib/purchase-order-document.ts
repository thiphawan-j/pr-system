/** Shared, serializable A4 layout. Coordinates are PDF points from the top left. */
export type PurchaseOrderDocumentText = {
  type: "text";
  x: number;
  /** Text baseline measured from the top of the page. */
  y: number;
  text: string;
  size: number;
  bold?: boolean;
  color?: string;
  align?: "left" | "center" | "right";
};

export type PurchaseOrderDocumentElement = PurchaseOrderDocumentText | {
  type: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  fill?: string;
  stroke?: string;
} | {
  type: "line";
  x: number;
  y: number;
  x2: number;
  y2: number;
  color: string;
};

export type PurchaseOrderDocument = {
  width: number;
  height: number;
  poNumber: string;
  pages: { elements: PurchaseOrderDocumentElement[] }[];
};
