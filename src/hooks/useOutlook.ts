import { useCallback, useEffect, useState } from "react";
import { api } from "./useMarket";
import { cacheOutlook, readCachedOutlook, validateBenchmark } from "../lib/forecast";
import type { BrowserModel, Outlook } from "../lib/types";

export type OutlookPhase = "checking" | "downloading" | "predicting" | "ready" | "error";
export function useOutlook() {
  const [outlook, setOutlook] = useState<Outlook>();
  const [phase, setPhase] = useState<OutlookPhase>("checking");
  const [error, setError] = useState("");
  const [modelId, setModelId] = useState<BrowserModel>("chronos-bolt-small");
  const [progress, setProgress] = useState({ loaded: 0, total: 0, cached: false });
  const [cached, setCached] = useState(false);
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision((n) => n + 1), []);

  useEffect(() => {
    try {
      const choice = localStorage.getItem("brent:preferred-model");
      if (choice === "chronos-bolt-tiny") setModelId(choice);
    } catch { /* Optional preference storage. */ }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let stopped = false;
    const update = async () => {
      setPhase("checking"); setError(""); setCached(false);
      setProgress({ loaded: 0, total: 0, cached: false });
      try {
        const benchmark = validateBenchmark(await api<unknown>("/api/benchmark", controller.signal));
        if (stopped) return;
        let previous;
        try { previous = readCachedOutlook(localStorage, benchmark, modelId); } catch { /* Storage unavailable. */ }
        if (previous) {
          setOutlook(previous); setCached(true); setPhase("ready"); return;
        }
        setPhase("downloading");
        const { runBrowserForecast } = await import("../lib/browserForecast");
        if (stopped) return;
        const result = await runBrowserForecast(benchmark, modelId, controller.signal,
          (value) => { if (!stopped) setProgress(value); },
          () => { if (!stopped) setPhase("predicting"); });
        if (stopped) return;
        try { cacheOutlook(localStorage, benchmark, result); } catch { /* Storage unavailable. */ }
        setOutlook(result); setPhase("ready");
      } catch (cause) {
        if (!stopped) {
          console.error("Browser forecast failed", cause);
          setError(phaseMessage(cause)); setPhase("error");
        }
      }
    };
    void update();
    return () => { stopped = true; controller.abort(); };
  }, [modelId, revision]);

  const chooseModel = useCallback((choice: BrowserModel) => {
    try { localStorage.setItem("brent:preferred-model", choice); } catch { /* Optional. */ }
    setModelId(choice);
  }, []);

  return { outlook, phase, error, progress, modelId, chooseModel, cached, retry,
    loading: phase === "checking" || phase === "downloading" || phase === "predicting" };
}

function phaseMessage(error: unknown) {
  const code = (error as { code?: string })?.code;
  if (code === "LOAD_FAILED")
    return "The prediction model could not load. Check your connection, retry, or use the smaller 18 MB model.";
  return error instanceof Error ? error.message : "The prediction could not be calculated. Try again.";
}
