// llmchat_web/static/js/utils.js

/**
 * @file utils.js
 * @description Utility functions for the llmchat-web interface.
 * This file contains general-purpose helper functions and
 * initializes global state variables to ensure they are defined early.
 * It now includes a debounced, API-driven token estimator.
 */

// --- Global State Variables Initialization ---
// Explicitly attach to the window object to ensure global availability
// and initialize as objects/arrays immediately. These will be populated
// by main_controller.js and used by other UI modules.

/** @type {string|null} Stores the current LLMCore session ID. */
window.currentLlmSessionId = null;

/** @type {Array<Object>} Stores items staged by the user for the active context. */
window.stagedContextItems = [];

/** @type {Object} Stores current RAG settings. */
window.currentRagSettings = {
  enabled: false,
  collectionName: null,
  kValue: 3,
  filter: null,
};

/** @type {Object} Stores current LLM settings. */
window.currentLlmSettings = {
  providerName: null,
  modelName: null,
  systemMessage: "",
};

/** @type {Object} Stores current Prompt Template Values. */
window.currentPromptTemplateValues = {};

/** @type {number|null} Stores the timeout ID for debouncing token estimations. */
let tokenEstimateDebounceTimer = null;

console.log("UTILS.JS: Global state variables initialized on window object.");

// --- Utility Functions ---

/**
 * Escapes HTML special characters in a string.
 * @param {string} unsafe - The string to escape.
 * @returns {string} The escaped string.
 */
function escapeHtml(unsafe) {
  if (unsafe === null || typeof unsafe === "undefined") return "";
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Displays a Bootstrap toast notification.
 * @param {string} title - The title of the toast.
 * @param {string} message - The message body of the toast.
 * @param {string} type - Type of toast ('success', 'warning', 'danger', 'info').
 * @param {boolean} needsConfirmation - If true, adds Yes/No buttons.
 * @param {function} callback - Callback function for confirmation (receives true for Yes, false for No/Dismiss).
 */
function showToast(
  title,
  message,
  type = "info",
  needsConfirmation = false,
  callback = null,
) {
  const toastId = `toast-${Date.now()}`;
  let buttonsHtml = "";
  if (needsConfirmation) {
    buttonsHtml = `
            <div class="mt-2 pt-2 border-top">
                <button type="button" class="btn btn-primary btn-sm btn-yes">Yes</button>
                <button type="button" class="btn btn-secondary btn-sm btn-no" data-bs-dismiss="toast">No</button>
            </div>
        `;
  }

  const toastHtml = `
        <div id="${toastId}" class="toast align-items-center text-white bg-${type} border-0" role="alert" aria-live="assertive" aria-atomic="true" data-bs-autohide="${!needsConfirmation}" data-bs-delay="${needsConfirmation ? "15000" : "5000"}">
            <div class="d-flex">
                <div class="toast-body">
                    <strong>${escapeHtml(title)}</strong><br>
                    ${escapeHtml(message)}
                    ${buttonsHtml}
                </div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
        </div>
    `;
  if ($("#toast-container").length === 0) {
    $("body").append(
      '<div id="toast-container" class="toast-container position-fixed top-0 end-0 p-3" style="z-index: 1056"></div>',
    );
  }
  $("#toast-container").append(toastHtml);
  const toastElement = new bootstrap.Toast(document.getElementById(toastId));
  toastElement.show();

  const toastDomElement = document.getElementById(toastId);
  let confirmationHandled = false;

  if (needsConfirmation && callback) {
    $(toastDomElement)
      .find(".btn-yes")
      .on("click", function () {
        if (!confirmationHandled) {
          confirmationHandled = true;
          callback(true);
          toastElement.hide();
        }
      });
    $(toastDomElement)
      .find(".btn-no")
      .on("click", function () {
        if (!confirmationHandled) {
          confirmationHandled = true;
          callback(false);
        }
      });
  }

  toastDomElement.addEventListener("hidden.bs.toast", function () {
    if (needsConfirmation && callback && !confirmationHandled) {
      callback(false);
    }
    this.remove();
  });
}

/**
 * Updates the context usage display in the top status bar.
 * @param {object | null} contextUsage - Object with tokens_used and max_tokens, or null.
 */
function updateContextUsageDisplay(contextUsage) {
  const $contextUsageEl = $("#status-context-usage");
  if (
    contextUsage &&
    contextUsage.tokens_used !== undefined &&
    contextUsage.tokens_used !== null &&
    contextUsage.max_tokens !== undefined &&
    contextUsage.max_tokens !== null
  ) {
    const percentage =
      contextUsage.max_tokens > 0
        ? ((contextUsage.tokens_used / contextUsage.max_tokens) * 100).toFixed(
            1,
          )
        : 0;
    $contextUsageEl.text(
      `${contextUsage.tokens_used}/${contextUsage.max_tokens} (${percentage}%)`,
    );
    if (percentage > 85) {
      $contextUsageEl
        .removeClass("bg-info bg-success bg-warning")
        .addClass("bg-danger");
    } else if (percentage > 60) {
      $contextUsageEl
        .removeClass("bg-info bg-success bg-danger")
        .addClass("bg-warning");
    } else {
      $contextUsageEl
        .removeClass("bg-info bg-warning bg-danger")
        .addClass("bg-success");
    }
  } else {
    $contextUsageEl
      .text("N/A")
      .removeClass("bg-success bg-warning bg-danger")
      .addClass("bg-info");
  }
}

/**
 * Updates the token estimate display for the chat input by making a debounced
 * API call to the backend. This provides a more accurate, model-specific token count.
 */
function updateChatInputTokenEstimate() {
  clearTimeout(tokenEstimateDebounceTimer);

  const text = $("#chat-input").val();
  const $tokenDisplay = $("#chat-input-token-estimate");

  if (!text) {
    $tokenDisplay.text("Tokens: ~0");
    return;
  }

  // Use a short debounce delay to avoid spamming the API while typing.
  tokenEstimateDebounceTimer = setTimeout(async () => {
    const providerName = window.currentLlmSettings?.providerName;
    const modelName = window.currentLlmSettings?.modelName;

    if (!providerName) {
      // Don't show an error, just indicate we can't estimate yet.
      $tokenDisplay.text("Tokens: (select provider)");
      return;
    }

    $tokenDisplay.text("Tokens: Calculating...");

    try {
      const response = await fetch("/api/utils/estimate_tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text,
          provider_name: providerName,
          model_name: modelName, // Can be null, backend will use provider's default
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "API error");
      }

      const data = await response.json();
      $tokenDisplay.text(`Tokens: ~${data.token_count}`);
    } catch (error) {
      console.error("UTILS.JS: Error estimating chat input tokens:", error);
      $tokenDisplay.text("Tokens: Error");
      // Silently fail in the UI to avoid distracting the user.
    }
  }, 300); // 300ms debounce delay
}
