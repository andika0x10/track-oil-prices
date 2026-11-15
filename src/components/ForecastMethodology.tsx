import type { Outlook } from "../lib/types";

export default function ForecastMethodology({ outlook }: { outlook?: Outlook }) {
  return <div className="method-body" id="method-body">
    <div className="method-columns">
      <div><h3>Use the latest published history</h3><p>
        Complete monthly Europe Brent spot averages come from EIA. The page checks for new data when you open it.
        The live Hyperliquid contract is a separate instrument.
      </p></div>
      <div><h3>Calculate on your device</h3><p>
        Amazon’s pretrained Chronos-Bolt model reads the price history and predicts future monthly averages.
        It runs in your browser, without training a new model or sending your data to an inference service.
        Unchanged inputs reuse a saved calculation.
      </p></div>
      <div><h3>Keep uncertainty visible</h3><p>
        The central estimate is the model’s median. Shading spans its 10th to 90th percentiles, a nominal 80% range.
        Beyond 36 months, the chart shows explicit assumption-based scenarios.
      </p></div>
    </div>
    <p className="evaluation-empty">
      Accuracy and range coverage on Brent have not yet been established for this model.
      General forecasting benchmarks do not demonstrate that it beats an unchanged-price forecast for oil.
    </p>
    {outlook?.inference && <details className="model-details">
      <summary>Model and calculation details</summary>
      <dl className="detail-meta">
        <div><dt>Pretrained model</dt><dd><a href={`https://huggingface.co/amazon/${outlook.inference.modelId}`} target="_blank" rel="noreferrer">{outlook.model.model}</a></dd></div>
        <div><dt>Browser export</dt><dd>forecast-web 1.0.0 · community ONNX conversion</dd></div>
        <div><dt>Execution</dt><dd>{outlook.inference.backend === "webgpu" ? "WebGPU" : "ONNX Runtime CPU"} · Web Worker</dd></div>
        <div><dt>Inference time</dt><dd>{(outlook.performance.computationMs / 1000).toFixed(2)} seconds</dd></div>
        <div><dt>Calculated</dt><dd>{new Date(outlook.generatedAt).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}</dd></div>
        <div><dt>Export revision</dt><dd className="revision-hash">{outlook.inference.revision}</dd></div>
      </dl>
    </details>}
    <p className="method-small">
      This model uses price history only. It does not read current news or anticipate geopolitical events.
      EIA history can include revisions. Model weights are fixed; newly published prices become fresh prediction inputs.
      Scenarios assume 2% annual USD inflation and −2%, 0%, or +2% annual real price growth.
    </p>
  </div>;
}
