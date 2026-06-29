export type FieldType = "name" | "plate" | "phone";
export type Band = "green" | "amber" | "red";

/** image-relative percentages for an overlay box */
export interface OverlayBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ReconciledField {
  type: FieldType;
  /** interpreted value after rules normalisation */
  value: string;
  /** raw OCR value before normalisation */
  ocrValue: string;
  ocrConfidence: number;
  ruleConfidence: number;
  /** ocrConfidence x ruleConfidence */
  confidence: number;
  band: Band;
  note?: string;
  overlay?: OverlayBox;
}

export interface ScanRow {
  id: string;
  rowIndex: number;
  name: string;
  plate: string;
  phone: string;
  fields: ReconciledField[];
  confidence: Record<FieldType, number>;
  band: Band;
}

/** A single DI cell/word normalised into the shape the pipeline consumes. */
export interface RawToken {
  content: string;
  confidence: number;
  /** raw polygon, pixels: [x1,y1,x2,y2,x3,y3,x4,y4] */
  polygon: number[];
  rowIndex?: number;
  columnIndex?: number;
}
