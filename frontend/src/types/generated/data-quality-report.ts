/* Generated from docs/contracts/data-quality-report.schema.json. Do not edit by hand. Run npm run generate:api. */

/**
 * What FaultIQ found in one uploaded file before any analysis ran.
 */
export interface DataQualityReport {
  /**
   * The user's file name, for display only
   */
  file: string;
  /**
   * Absent when the file was quarantined
   */
  grid?: GridSummary | null;
  issues: QualityIssue[];
  /**
   * Absent when the columns could not be read
   */
  load?: LoadSummary | null;
  /**
   * Point mapping used to read the file
   */
  mapping: string;
  /**
   * Share of rows with no usable value, per sensor role, after loading
   */
  missing_share?: {
    [k: string]: number;
  };
  /**
   * Absent when quarantined
   */
  operating?: OperatingSummary | null;
  pipeline_version: string;
  sha256: string;
  status: "accepted" | "accepted_with_warnings" | "quarantined";
  version?: number;
}
export interface GridSummary {
  /**
   * Missing steps flagged as not observed, not filled
   */
  inserted_missing_rows: number;
  output_rows: number;
  /**
   * Continuous stretches; a gap over an hour starts a new one
   */
  segments: number;
  /**
   * The file's sampling interval
   */
  step_seconds: number;
}
export interface QualityIssue {
  /**
   * Stable code, e.g. timestamps_out_of_order
   */
  code: string;
  /**
   * What is wrong and, where possible, how to fix it
   */
  message: string;
  severity: "error" | "warning";
}
export interface LoadSummary {
  /**
   * Rows where every probe sensor read exactly 0
   */
  dropout_rows: number;
  duplicate_timestamps: number;
  /**
   * Columns the mapping excludes, with why
   */
  excluded_columns: {
    [k: string]: string;
  };
  gaps_over_1min: number;
  /**
   * Data rows read from the file
   */
  rows: number;
  /**
   * Columns ignored because the mapping omits them
   */
  unmapped_columns: string[];
  unreadable_timestamps: number;
}
export interface OperatingSummary {
  /**
   * Share of rows in each operating mode
   */
  mode_share: {
    [k: string]: number;
  };
  /**
   * Share of rows in steady state
   */
  steady_share: number;
}
