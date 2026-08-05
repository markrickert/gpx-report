import { useState } from "react";
import { useMutation } from "@apollo/client";
import { REANALYZE_ALL, REANALYZE_RANGE } from "../graphql/queries.js";

const RANGE_OPTIONS = [
  { label: "Last Week", days: 7 },
  { label: "Last Month", days: 30 },
  { label: "Last Year", days: 365 },
];

export default function Settings() {
  const [status, setStatus] = useState(null);
  const [reanalyzeAll, { loading: loadingAll }] = useMutation(REANALYZE_ALL);
  const [reanalyzeRange, { loading: loadingRange }] = useMutation(REANALYZE_RANGE);

  async function handleReanalyzeAll() {
    setStatus("Initiating re-analysis for all activities...");
    const { data } = await reanalyzeAll();
    setStatus(data.reanalyzeAllActivities.message);
  }

  async function handleReanalyzeRange(days, label) {
    setStatus(`Initiating re-analysis for ${label}...`);
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
    const { data } = await reanalyzeRange({
      variables: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
    });
    setStatus(data.reanalyzeActivitiesByDateRange.message);
  }

  const busy = loadingAll || loadingRange;

  return (
    <div>
      <h1>Settings</h1>
      <h2>Re-analysis</h2>
      <div className="button-row">
        {RANGE_OPTIONS.map((opt) => (
          <button key={opt.label} disabled={busy} onClick={() => handleReanalyzeRange(opt.days, opt.label)}>
            {opt.label}
          </button>
        ))}
        <button disabled={busy} onClick={handleReanalyzeAll}>
          All Time
        </button>
      </div>
      {status && <p>{status}</p>}
    </div>
  );
}
