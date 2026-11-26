import { Cpu } from "lucide-react";
import { Link } from "react-router";

import { Empty, Freshness, QueryView } from "../components/QueryState";
import { Badge, Card, CardTitle, tableClass } from "../components/ui";
import { useFaultTitles, useModels } from "../hooks/queries";
import { formatDateTime, formatNumber, formatPercent } from "../lib/format";
import { faultTitle, FORMAT_LABEL } from "../lib/labels";
import { TONE } from "../lib/tone";
import type { ModelResponse } from "../types/api";

// Model and pipeline versions (project plan, section 10; ADR 0027). Held-out results describe the
// diagnosis method; installed model files are trained locally with it, so each entry also lists the
// versions actually recorded on this installation's analyses.

const MODEL_LABEL: Record<string, string> = { lightgbm: "LightGBM", logistic: "Logistic regression" };

/** A share near, but not at, 100% keeps a decimal, so 99.8% never reads as certain. */
const share = (x: number) => formatPercent(x, x > 0.99 && x < 1 ? 1 : 0);

function HeldOut({ m, target }: { m: ModelResponse; target: number }) {
  const h = m.held_out;
  const rows: [string, string, string][] = [
    ["Macro-F1 on test hours", h.test_macro_f1.toFixed(2), `validation ${h.validation_macro_f1.toFixed(2)}`],
    ["Hours answered", share(h.answered_share), "the rest were inconclusive"],
    [
      "Named faults right",
      share(h.named_fault_precision),
      h.named_fault_precision >= target ? `meets the ${formatPercent(target)} target` : `below the ${formatPercent(target)} target`,
    ],
    ["Faulty hours given the right fault", share(h.right_fault_on_faulty_hours), ""],
    ["Calibration error", h.calibration_error.toFixed(2), "lower is better"],
  ];
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {rows.map(([k, v, note]) => (
        <div key={k}>
          <dt className="text-xs text-muted">{k}</dt>
          <dd className="font-medium text-ink tabular-nums">
            {v} {note && <span className="text-xs font-normal text-muted">{note}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ModelCard({ m, target, titles }: { m: ModelResponse; target: number; titles: Record<string, string> }) {
  const heading = `model-${m.format}-${m.point_set}`;
  return (
    <Card aria-labelledby={heading}>
      <CardTitle
        id={heading}
        sub={`${m.dataset_label} · ${FORMAT_LABEL[m.format] ?? m.format}`}
        aside={<Badge className={TONE.accent}>{MODEL_LABEL[m.adopted_model] ?? m.adopted_model}</Badge>}
      >
        {m.point_set === "all" ? "All points" : "Basic points only"}
      </CardTitle>
      <div className="space-y-4">
        <div>
          <h3 className="mb-2 text-sm font-semibold text-ink">Held-out results ({formatNumber(m.held_out.test_hours)} test hours)</h3>
          <HeldOut m={m} target={target} />
        </div>
        <div className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <h3 className="mb-1 text-sm font-semibold text-ink">How it was tested</h3>
            <p className="text-ink-2">{m.evaluation}</p>
          </div>
          <div>
            <h3 className="mb-1 text-sm font-semibold text-ink">Installed model trained on</h3>
            <p className="text-ink-2">Train: {m.trained_on.train}. Validation: {m.trained_on.validation}.</p>
          </div>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold text-ink">Faults it can name</h3>
          <ul className="flex flex-wrap gap-2">
            {m.faults.map((f) => (
              <li key={f}>
                <Link to={`/library/${f}`} className="text-sm text-accent underline underline-offset-2">
                  {titles[f] ?? faultTitle(f)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold text-ink">Versions used on this installation</h3>
          {m.versions.length ? (
            <div className="overflow-x-auto">
              <table className={tableClass}>
                <caption className="sr-only">Model versions recorded on stored analyses</caption>
                <thead>
                  <tr>
                    <th scope="col" className="font-medium">Model version</th>
                    <th scope="col" className="font-medium">Pipeline</th>
                    <th scope="col" className="text-right font-medium">Analyses</th>
                    <th scope="col" className="font-medium">Last used</th>
                  </tr>
                </thead>
                <tbody>
                  {m.versions.map((v) => (
                    <tr key={v.model_version} className="border-t border-line">
                      <td className="py-1 font-mono text-xs break-all">{v.model_version}</td>
                      <td className="py-1">{v.pipeline_versions.join(", ")}</td>
                      <td className="py-1 text-right tabular-nums">{formatNumber(v.analyses)}</td>
                      <td className="py-1 whitespace-nowrap">{formatDateTime(v.last_used_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted">No analysis has used this model yet.</p>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function ModelsPage() {
  const models = useModels();
  const titles = useFaultTitles();
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Cpu aria-hidden="true" className="size-6 text-accent" />
            Models
          </h1>
          <p className="max-w-3xl text-sm text-muted">
            Which model names each fault, what it was trained on, and how well the method did on data it never saw.
          </p>
        </div>
        <Freshness query={models} />
      </div>
      <QueryView query={models} loadingLabel="Loading models…">
        {(data) => (
          <div className="space-y-6">
            <p className="rounded-lg border border-info-line bg-info-soft px-3 py-2 text-sm text-info">
              These results describe the diagnosis method (version {data.diagnosis_version}), measured on {data.evaluated_on} with
              pipeline {data.evaluated_with_pipeline_version} on held-out LBNL data. Model files are trained on each installation
              with the same method, so the version recorded on an analysis identifies the exact file. All results come from
              simulated or laboratory units; performance on other buildings is not yet known.
            </p>
            {data.items.length === 0 ? (
              <Empty>No models are registered.</Empty>
            ) : (
              <div className="grid gap-6 xl:grid-cols-2">
                {data.items.map((m) => (
                  <ModelCard key={`${m.format}-${m.point_set}`} m={m} target={data.target_named_fault_precision} titles={titles} />
                ))}
              </div>
            )}
          </div>
        )}
      </QueryView>
    </div>
  );
}
