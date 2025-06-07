// llmchat_web/static/js/main_controller.js

/**
 * @file main_controller.js
 * @description Main JavaScript controller for the llmchat-web interface.
 * This file initializes various UI modules and handles global state management,
 * initial status fetching, session list display, and other top-level UI interactions.
 * This version adds theme management and final UI polish from Phase 6.
 *
 * Global state variables (e.g., window.currentLlmSettings) are initialized in utils.js.
 * This script populates them based on backend status and user interactions.
 *
 * Depends on:
 * - utils.js (for global state init, escapeHtml, showToast, etc.)
 * - session_api.js
 * - chat_ui.js
 * - rag_ui.js
 * - llm_settings_ui.js
 * - context_manager_ui.js
 * - prompt_template_ui.js
 * - ingestion_ui.js
 */

// Note: Global state variables (window.currentLlmSessionId, window.stagedContextItems,
// window.currentRagSettings, window.currentLlmSettings, window.currentPromptTemplateValues)
// are DECLARED and INITIALIZED in utils.js to ensure they exist before any other script runs.
// This script (main_controller.js) will POPULATE these global variables.

// =================================================================================
// SECTION: Theme Management
// =================================================================================

/**
 * Applies the selected theme by updating the override stylesheet and HTML attributes.
 * Also saves the preference to localStorage.
 * @param {string} themeName - The name of the theme to apply ('light' or 'dark').
 */
function applyTheme(themeName) {
  console.log(`MAIN_CTRL: Applying theme: ${themeName}`);
  const themeOverrideSheet = $("#theme-override-stylesheet");
  const htmlElement = $("html");

  if (themeName === "light") {
    themeOverrideSheet.attr("href", "/static/css/themes/light.css");
    htmlElement.attr("data-bs-theme", "light");
  } else {
    themeOverrideSheet.attr("href", "");
    htmlElement.attr("data-bs-theme", "dark");
  }
  try {
    localStorage.setItem("llmchat_theme", themeName);
    console.log(
      `MAIN_CTRL: Theme preference '${themeName}' saved to localStorage.`,
    );
  } catch (e) {
    console.warn(
      "MAIN_CTRL: Could not save theme preference to localStorage.",
      e,
    );
  }
}

/**
 * Initializes the theme based on the user's saved preference in localStorage,
 * or defaults to dark.
 */
function initializeTheme() {
  let preferredTheme = null;
  try {
    preferredTheme = localStorage.getItem("llmchat_theme");
  } catch (e) {
    console.warn(
      "MAIN_CTRL: Could not read theme preference from localStorage.",
      e,
    );
  }

  if (preferredTheme) {
    console.log(
      `MAIN_CTRL: Found saved theme in localStorage: ${preferredTheme}.`,
    );
    applyTheme(preferredTheme);
  } else {
    console.log(
      "MAIN_CTRL: No theme saved in localStorage. Defaulting to dark theme.",
    );
    applyTheme("dark"); // Default to dark if nothing is set
  }
}

// =================================================================================
// SECTION: Core UI State and Initialization
// =================================================================================

/**
 * Enables or disables the main chat input panel based on session state.
 * @param {boolean} isEnabled - True to enable, false to disable.
 */
function updateChatPanelState(isEnabled) {
  const $chatInput = $("#chat-input");
  const $sendButton = $("#send-chat-message");

  if (isEnabled) {
    $chatInput
      .prop("disabled", false)
      .attr("placeholder", "Type your message...");
    $sendButton.prop("disabled", false);
  } else {
    $chatInput
      .prop("disabled", true)
      .attr("placeholder", "Create or load a session to begin chatting.");
    $sendButton.prop("disabled", true);
  }
  console.log(`MAIN_CTRL: Chat panel state set to enabled: ${isEnabled}`);
}

/**
 * Fetches initial status from the backend and updates the UI and global state.
 * This function is called when the DOM is ready.
 * It orchestrates calls to various UI update functions from different modules.
 */
function fetchAndUpdateInitialStatus() {
  console.log("MAIN_CTRL: Fetching initial status from /api/status...");
  $.ajax({
    url: "/api/status",
    type: "GET",
    dataType: "json",
    success: function (status) {
      console.log("MAIN_CTRL: Initial status received:", status);

      if (status.app_version) {
        $("#app-version-display").text(`v${status.app_version}`);
      }

      if (status.llmcore_status === "operational") {
        $("#llmcore-status-sidebar")
          .removeClass("bg-danger bg-warning")
          .addClass("bg-success")
          .text("OK");
      } else if (status.llmcore_status === "initializing") {
        $("#llmcore-status-sidebar")
          .removeClass("bg-danger bg-success")
          .addClass("bg-warning")
          .text("Initializing");
      } else {
        $("#llmcore-status-sidebar")
          .removeClass("bg-success bg-warning")
          .addClass("bg-danger")
          .text("Error");
        if (status.llmcore_error) {
          showToast("LLMCore Error", status.llmcore_error, "danger");
        }
      }

      window.currentLlmSessionId = status.current_session_id;
      console.log(
        "MAIN_CTRL: Set window.currentLlmSessionId to:",
        window.currentLlmSessionId,
      );

      updateChatPanelState(!!window.currentLlmSessionId);

      // Ensure global settings objects are initialized
      if (typeof window.currentLlmSettings !== "object")
        window.currentLlmSettings = {};
      if (typeof window.currentRagSettings !== "object")
        window.currentRagSettings = {};
      if (typeof window.currentPromptTemplateValues !== "object")
        window.currentPromptTemplateValues = {};

      window.currentLlmSettings.providerName = status.current_provider || null;
      window.currentLlmSettings.modelName = status.current_model || null;
      window.currentLlmSettings.systemMessage = status.system_message || "";
      $("#status-provider").text(
        window.currentLlmSettings.providerName || "N/A",
      );
      $("#status-model").text(window.currentLlmSettings.modelName || "N/A");
      if (typeof fetchAndPopulateLlmProviders === "function")
        fetchAndPopulateLlmProviders();
      if (typeof fetchAndDisplaySystemMessage === "function")
        fetchAndDisplaySystemMessage();

      window.currentRagSettings.enabled = status.rag_enabled || false;
      window.currentRagSettings.collectionName =
        status.rag_collection_name || null;
      window.currentRagSettings.kValue = status.rag_k_value || 3;
      window.currentRagSettings.filter = status.rag_filter || null;
      if (typeof updateRagControlsState === "function")
        updateRagControlsState();
      if (typeof fetchAndPopulateRagCollections === "function")
        fetchAndPopulateRagCollections();

      window.currentPromptTemplateValues = status.prompt_template_values || {};
      if (typeof fetchAndDisplayPromptTemplateValues === "function")
        fetchAndDisplayPromptTemplateValues();

      if (typeof updateContextUsageDisplay === "function")
        updateContextUsageDisplay(null);

      fetchAndDisplaySessions();

      if (!window.currentLlmSessionId) {
        $("#chat-messages")
          .empty()
          .append(
            '<div class="message-bubble agent-message">No active session. Create or load one.</div>',
          );
        window.stagedContextItems = [];
        if (typeof renderStagedContextItems === "function")
          renderStagedContextItems();
      }

      console.log(
        "MAIN_CTRL: Initial UI state updated from /api/status response.",
      );
    },
    error: function (jqXHR, textStatus, errorThrown) {
      console.error(
        "MAIN_CTRL: Error fetching initial status:",
        textStatus,
        errorThrown,
      );
      showToast(
        "Initialization Error",
        "Could not fetch initial server status. Some features may not work.",
        "danger",
      );
      updateChatPanelState(false);
    },
  });
}

/**
 * Fetches and displays the list of saved sessions, including per-session delete icons.
 * Highlights the currentLlmSessionId if active.
 */
function fetchAndDisplaySessions() {
  console.log("MAIN_CTRL: Fetching sessions via apiFetchSessions...");
  apiFetchSessions() // from session_api.js
    .done(function (sessions) {
      const $sessionList = $("#session-list").empty();
      if (sessions && sessions.length > 0) {
        sessions.forEach(function (session) {
          const deleteButtonHtml = `
                        <button class="btn btn-sm btn-outline-danger btn-delete-session-item" data-session-id="${escapeHtml(session.id)}" title="Delete Session">
                            <i class="fas fa-trash-alt fa-xs"></i>
                        </button>`;

          const $sessionItem = $("<a>", {
            href: "#",
            class:
              "list-group-item list-group-item-action d-flex justify-content-between align-items-center",
            "data-session-id": session.id,
            html: `<div>
                                   <div class="fw-bold">${escapeHtml(session.name) || escapeHtml(session.id.substring(0, 15)) + "..."}</div>
                                   <small class="text-muted">Messages: ${session.message_count || 0}</small>
                               </div>
                               ${deleteButtonHtml}`,
          });
          if (session.id === window.currentLlmSessionId) {
            $sessionItem.addClass("active");
          }
          $sessionList.append($sessionItem);
        });
      } else {
        $sessionList.append(
          '<p class="text-muted small m-2">No saved sessions found.</p>',
        );
      }
    })
    .fail(function (jqXHR, textStatus, errorThrown) {
      console.error(
        "MAIN_CTRL: Error fetching sessions:",
        textStatus,
        errorThrown,
      );
      $("#session-list").html(
        '<p class="text-danger small m-2">Error loading sessions.</p>',
      );
    });
}

/**
 * Fetches application logs from the backend and displays them in the logs modal.
 */
function fetchAndDisplayAppLogs() {
  const $logsDisplay = $("#app-logs-display");
  $logsDisplay.text("Fetching logs...");
  $.ajax({
    url: "/api/logs",
    type: "GET",
    dataType: "json",
    success: function (response) {
      if (response.logs) {
        $logsDisplay.text(response.logs);
        $logsDisplay.scrollTop($logsDisplay[0].scrollHeight);
      } else {
        $logsDisplay.text(
          response.error || "No log content received or empty log file.",
        );
      }
    },
    error: function (jqXHR) {
      const errorMsg =
        jqXHR.responseJSON?.error || "Failed to fetch logs from server.";
      $logsDisplay.text(`Error: ${escapeHtml(errorMsg)}`);
    },
  });
}

// =================================================================================
// SECTION: Document Ready and Event Listeners
// =================================================================================
$(document).ready(function () {
  console.log("MAIN_CTRL: Document ready. Initializing application...");

  initializeTheme(); // Apply saved theme on page load
  fetchAndUpdateInitialStatus(); // Initial load of status and UI elements

  // Initialize event listeners from other UI modules
  if (typeof initChatEventListeners === "function") initChatEventListeners();
  if (typeof initRagEventListeners === "function") initRagEventListeners();
  if (typeof initLlmSettingsEventListeners === "function")
    initLlmSettingsEventListeners();
  if (typeof initContextManagerEventListeners === "function")
    initContextManagerEventListeners();
  if (typeof initPromptTemplateEventListeners === "function")
    initPromptTemplateEventListeners();
  if (typeof initIngestionEventListeners === "function")
    initIngestionEventListeners();

  // --- Theme Switcher Event Listener ---
  $(".dropdown-menu a[data-theme]").on("click", function (e) {
    e.preventDefault();
    const selectedTheme = $(this).data("theme");
    applyTheme(selectedTheme);
  });

  // --- New Session Button ---
  $("#btn-new-session").on("click", function () {
    apiCreateNewSession()
      .done(function (newSessionResponse) {
        window.currentLlmSessionId = newSessionResponse.id;
        $("#chat-messages")
          .empty()
          .append(
            '<div class="message-bubble agent-message">New session started.</div>',
          );
        updateChatPanelState(true);
        fetchAndUpdateInitialStatus(); // Reload everything to reflect default settings
      })
      .fail(function () {
        showToast("Error", "Failed to create new session context.", "danger");
      });
  });

  // --- Load Session from List ---
  $("#session-list").on("click", "a.list-group-item", function (e) {
    e.preventDefault();
    const sessionIdToLoad = $(this).data("session-id");
    if (sessionIdToLoad === window.currentLlmSessionId) return;

    apiLoadSession(sessionIdToLoad)
      .done(function (response) {
        const loadedSessionData = response.session_data;
        const appliedSettings = response.applied_settings;
        if (!loadedSessionData) {
          showToast("Error", "Invalid session data received.", "danger");
          return;
        }
        window.currentLlmSessionId = loadedSessionData.id;
        updateChatPanelState(true);
        $("#chat-messages").empty();
        if (
          loadedSessionData.messages &&
          loadedSessionData.messages.length > 0
        ) {
          loadedSessionData.messages.forEach((msg) => {
            if (typeof appendMessageToChat === "function")
              appendMessageToChat(msg.content, msg.role, false, msg.id);
          });
        }
        // Update global state and UI
        if (appliedSettings) {
          window.currentLlmSettings.providerName =
            appliedSettings.current_provider_name;
          window.currentLlmSettings.modelName =
            appliedSettings.current_model_name;
          window.currentLlmSettings.systemMessage =
            appliedSettings.system_message;
          window.currentRagSettings.enabled = appliedSettings.rag_enabled;
          window.currentRagSettings.collectionName =
            appliedSettings.rag_collection_name;
          window.currentRagSettings.kValue = appliedSettings.k_value;
          window.currentRagSettings.filter = appliedSettings.rag_filter;
          window.currentPromptTemplateValues =
            appliedSettings.prompt_template_values || {};
        }
        fetchAndUpdateInitialStatus(); // Full refresh to ensure UI consistency
      })
      .fail(function () {
        showToast("Error", "Failed to load session.", "danger");
      });
  });

  // --- Per-Session Delete Button ---
  $("#session-list").on("click", ".btn-delete-session-item", function (e) {
    e.preventDefault();
    e.stopPropagation(); // Stop event from bubbling up to the session load handler
    const sessionIdToDelete = $(this).data("session-id");
    if (!sessionIdToDelete) return;

    showToast(
      "Confirm",
      `Delete session ${sessionIdToDelete}? This cannot be undone.`,
      "warning",
      true,
      function (confirmed) {
        if (confirmed) {
          apiDeleteSession(sessionIdToDelete)
            .done(function (response) {
              showToast(
                "Success",
                response.message || "Session deleted.",
                "success",
              );
              // If we deleted the current session, reset the UI state
              if (window.currentLlmSessionId === sessionIdToDelete) {
                window.currentLlmSessionId = null;
                fetchAndUpdateInitialStatus(); // This will reset everything
              } else {
                fetchAndDisplaySessions(); // Just refresh the list
              }
            })
            .fail(function (jqXHR) {
              showToast(
                "Error",
                jqXHR.responseJSON?.error || "Failed to delete session.",
                "danger",
              );
            });
        }
      },
    );
  });

  // --- Logs Modal Button ---
  $("#btn-view-app-logs").on("click", function () {
    fetchAndDisplayAppLogs();
    var appLogsModal = new bootstrap.Modal(
      document.getElementById("appLogsModal"),
    );
    appLogsModal.show();
  });

  // --- Chat Input Token Estimator ---
  $("#chat-input").on("input", function () {
    if (typeof updateChatInputTokenEstimate === "function")
      updateChatInputTokenEstimate();
  });
  if (typeof updateChatInputTokenEstimate === "function")
    updateChatInputTokenEstimate();

  console.log("MAIN_CTRL: LLMChat Web UI fully initialized.");
});
