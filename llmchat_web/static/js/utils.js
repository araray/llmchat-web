// llmchat_web/static/js/utils.js

/**
 * @file utils.js
 * @description Utility functions for the llmchat-web interface.
 * This file contains general-purpose helper functions.
 */

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
  // Ensure the toast container exists
  if ($("#toast-container").length === 0) {
    $("body").append(
      '<div id="toast-container" class="toast-container position-fixed top-0 end-0 p-3" style="z-index: 1056"></div>',
    );
  }
  $("#toast-container").append(toastHtml);
  const toastElement = new bootstrap.Toast(document.getElementById(toastId));
  toastElement.show();

  const toastDomElement = document.getElementById(toastId);
  let confirmationHandled = false; // Flag to ensure callback is only called once

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
          // Toast will hide due to data-bs-dismiss
        }
      });
  }

  toastDomElement.addEventListener("hidden.bs.toast", function () {
    if (needsConfirmation && callback && !confirmationHandled) {
      // If toast was dismissed by other means (e.g., close button) and confirmation was expected
      // Treat as 'No' or 'Cancel'
      callback(false);
    }
    this.remove();
  });
}
