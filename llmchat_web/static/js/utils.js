// llmchat_web/static/js/utils.js

/**
 * @file utils.js
 * @description Utility functions for the llmchat-web interface.
 * This file contains general-purpose helper functions and
 * initializes global state variables to ensure they are defined early.
 * It now includes a debounced, API-driven token estimator and logic for
 * a live-updating context counter.
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

/** @type {Object} Stores the last known authoritative context usage from the backend. */
window.lastBaseContextUsage = { tokens_used: 0, max_tokens: 0 };

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
 * It now calculates a total based on a base context object and an optional
 * additional token count from the current user input.
 * @param {object | null} baseUsage - Object with tokens_used and max_tokens for the base context.
 * This should be the authoritative count from the last turn.
 * @param {number} [promptTokens=0] - The number of tokens from the current text in the input box.
 */
function updateContextUsageDisplay(baseUsage, promptTokens = 0) {
  const $contextUsageEl = $("#status-context-usage");
  // Use the provided baseUsage, fall back to the global state, or finally to a zeroed object.
  const baseContext = baseUsage ||
    window.lastBaseContextUsage || { tokens_used: 0, max_tokens: 0 };

  const totalTokens = (baseContext.tokens_used || 0) + promptTokens;
  const maxTokens = baseContext.max_tokens || 0;

  if (maxTokens > 0) {
    const percentage = ((totalTokens / maxTokens) * 100).toFixed(1);
    $contextUsageEl.text(`${totalTokens}/${maxTokens} (${percentage}%)`);

    // Update color based on usage percentage
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
    // If max_tokens is 0 or unavailable, just show the token count.
    $contextUsageEl
      .text(`${totalTokens}/N/A`)
      .removeClass("bg-success bg-warning bg-danger")
      .addClass("bg-info");
  }
}

/**
 * Updates the token estimate display for the chat input AND updates the main context counter.
 * It makes a debounced API call for the input text and combines it with the last known base context size.
 */
function updateChatInputTokenEstimate() {
  clearTimeout(tokenEstimateDebounceTimer);

  const text = $("#chat-input").val();
  const $tokenDisplay = $("#chat-input-token-estimate");

  if (!text) {
    $tokenDisplay.text("Tokens: ~0");
    // Update the main display with just the base context when input is cleared
    updateContextUsageDisplay(window.lastBaseContextUsage, 0);
    return;
  }

  // Use a short debounce delay to avoid spamming the API while typing.
  tokenEstimateDebounceTimer = setTimeout(async () => {
    const providerName = window.currentLlmSettings?.providerName;
    const modelName = window.currentLlmSettings?.modelName;

    if (!providerName) {
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
          model_name: modelName,
        }),
      });

      if (!response.ok) {
        throw new Error("API error");
      }

      const data = await response.json();
      const promptTokens = data.token_count || 0;
      $tokenDisplay.text(`Tokens: ~${promptTokens}`);

      // NEW: Update the main top-bar counter with the combined total
      updateContextUsageDisplay(window.lastBaseContextUsage, promptTokens);
    } catch (error) {
      console.error("UTILS.JS: Error estimating chat input tokens:", error);
      $tokenDisplay.text("Tokens: Error");
      // Even on error, update the main display with what we know (the base)
      updateContextUsageDisplay(window.lastBaseContextUsage, 0);
    }
  }, 300); // 300ms debounce delay
}
