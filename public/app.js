// VIGILIA widget wiring. Vanilla JS, no framework.
// One textarea + one drop zone + one button. Renders evidence verbatim.

(function () {
  "use strict";

  const form = document.getElementById("check-form");
  const textInput = document.getElementById("input-text");
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("file-input");
  const fileName = document.getElementById("file-name");
  const dropHint = document.getElementById("drop-hint");
  const runBtn = document.getElementById("run-btn");

  const result = document.getElementById("result");
  const verdictBand = document.getElementById("verdict-band");
  const verdictLabel = document.getElementById("verdict-label");
  const confidenceLabel = document.getElementById("confidence-label");
  const evidenceList = document.getElementById("evidence-list");
  const explanation = document.getElementById("explanation");
  const recommendation = document.getElementById("recommendation");
  const checkidEl = document.getElementById("checkid");

  let selectedFile = null;

  // ---- Load configured price so the page never drifts from config ----
  fetch("/api/config")
    .then((r) => r.json())
    .then((cfg) => {
      if (!cfg || !cfg.pricePerCheckUsdt) return;
      const price = cfg.pricePerCheckUsdt + " USDT";
      const set = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
      };
      set("pricetag", price);
      set("hero-price", price);
      set("pricing-amount", price);
    })
    .catch(() => {});

  // ---- Drop zone ----
  function setFile(file) {
    selectedFile = file;
    if (file) {
      fileName.textContent = file.name;
      fileName.hidden = false;
      dropHint.textContent = "SCREENSHOT READY";
    } else {
      fileName.hidden = true;
      dropHint.textContent = "OR DROP A SCREENSHOT HERE";
    }
  }

  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener("change", () => {
    setFile(fileInput.files[0] || null);
  });
  ["dragenter", "dragover"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
    })
  );
  dropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer && e.dataTransfer.files[0];
    if (file) setFile(file);
  });

  // ---- Verdict rendering ----
  const VERDICT_CLASS = {
    SAFE: "safe",
    SUSPICIOUS: "suspicious",
    CONFIRMED_SCAM: "scam",
    ERROR: "error",
  };
  const VERDICT_TEXT = {
    SAFE: "VERDICT: SAFE",
    SUSPICIOUS: "VERDICT: SUSPICIOUS",
    CONFIRMED_SCAM: "VERDICT: CONFIRMED SCAM",
    ERROR: "VERDICT: ERROR",
  };

  function showError(message) {
    verdictBand.className = "verdict-band error";
    verdictLabel.textContent = VERDICT_TEXT.ERROR;
    confidenceLabel.textContent = "";
    evidenceList.innerHTML = "";
    explanation.textContent = message;
    recommendation.textContent =
      "Check your input and try again. If a link, include the full https:// address.";
    checkidEl.textContent = "";
    result.hidden = false;
    result.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function renderResult(data) {
    const vclass = VERDICT_CLASS[data.verdict] || "error";
    verdictBand.className = "verdict-band " + vclass;
    verdictLabel.textContent = VERDICT_TEXT[data.verdict] || "VERDICT";
    confidenceLabel.textContent = data.confidence
      ? "CONFIDENCE: " + String(data.confidence).toUpperCase()
      : "";

    evidenceList.innerHTML = "";
    (data.evidence || []).forEach((row) => {
      const li = document.createElement("li");
      li.className = "ev-" + row.result;

      const resultTag = document.createElement("span");
      resultTag.className = "ev-result";
      resultTag.textContent = String(row.result).toUpperCase();

      const sig = document.createElement("span");
      sig.className = "ev-sig";
      sig.textContent = row.signal;

      const detail = document.createElement("span");
      detail.className = "ev-detail";
      detail.textContent = row.detail;

      li.appendChild(resultTag);
      li.appendChild(sig);
      li.appendChild(detail);
      evidenceList.appendChild(li);
    });

    explanation.textContent = data.explanation || "";
    recommendation.textContent = data.recommendation || "";
    checkidEl.textContent = data.checkId ? "check " + data.checkId : "";

    result.hidden = false;
    result.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // ---- Submit ----
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = textInput.value.trim();

    if (!selectedFile && !text) {
      showError("No link or email content found. Paste a link/email or drop a screenshot.");
      return;
    }

    runBtn.disabled = true;
    runBtn.textContent = "CHECKING…";

    try {
      let res;
      if (selectedFile) {
        const fd = new FormData();
        fd.append("screenshot", selectedFile);
        res = await fetch("/api/demo", { method: "POST", body: fd });
      } else {
        const looksLikeUrl = /^https?:\/\/\S+$/i.test(text) || /^[\w-]+(\.[\w-]+)+\S*$/i.test(text);
        const body = looksLikeUrl && !/\s/.test(text) ? { url: text } : { emailText: text };
        res = await fetch("/api/demo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        showError((data && data.error) || "The check could not be completed. Please try again.");
      } else {
        renderResult(data);
      }
    } catch (err) {
      showError("Network error — could not reach the check service. Please try again.");
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = "RUN CHECK";
    }
  });
})();
