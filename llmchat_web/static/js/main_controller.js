// llmchat_web/static/js/main_controller.js

/**
 * @file main_controller.js
 * @description Main JavaScript controller for the llmchat-web interface.
 * This file initializes various UI modules and handles global state management,
 * initial status fetching, session list display, and other top-level UI interactions.
 * This version includes fixes for session creation UI and theme management.
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
 * @param {string} themeName - The name of the theme to apply ('light', 'dark', or custom).
 */
function applyTheme(themeName) {
  console.log(`MAIN_CTRL: Applying theme: ${themeName}`);
  const themeOverrideSheet = $("#theme-override-stylesheet");
  const htmlElement = $("html");

  if (themeName === "light" || themeName === "terminal_velocity") {
    themeOverrideSheet.attr("href", `/static/css/themes/${themeName}.css`);
    // Light theme uses light bootstrap components, dark/terminal use dark.
    htmlElement.attr("data-bs-theme", themeName === "light" ? "light" : "dark");
  } else {
    // Default to dark theme
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
  let preferredTheme = "dark"; // Default theme
  try {
    const savedTheme = localStorage.getItem("llmchat_theme");
    if (savedTheme) {
      preferredTheme = savedTheme;
    }
  } catch (e) {
    console.warn(
      "MAIN_CTRL: Could not read theme preference from localStorage.",
      e,
    );
  }
  applyTheme(preferredTheme);
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
      updateChatPanelState(!!window.currentLlmSessionId);

      // Initialize global state objects
      window.currentLlmSettings = {
        providerName: status.current_provider || null,
        modelName: status.current_model || null,
        systemMessage: status.system_message || "",
      };
      window.currentRagSettings = {
        enabled: status.rag_enabled || false,
        collectionName: status.rag_collection_name || null,
        kValue: status.rag_k_value || 3,
        filter: status.rag_filter || null,
      };
      window.currentPromptTemplateValues = status.prompt_template_values || {};

      // Update UI from new global state
      $("#status-provider").text(
        window.currentLlmSettings.providerName || "N/A",
      );
      $("#status-model").text(window.currentLlmSettings.modelName || "N/A");
      if (typeof fetchAndPopulateLlmProviders === "function")
        fetchAndPopulateLlmProviders();
      if (typeof fetchAndDisplaySystemMessage === "function")
        fetchAndDisplaySystemMessage();
      if (typeof updateRagControlsState === "function")
        updateRagControlsState();
      if (typeof fetchAndPopulateRagCollections === "function")
        fetchAndPopulateRagCollections();
      if (typeof fetchAndDisplayPromptTemplateValues === "function")
        fetchAndDisplayPromptTemplateValues();
      if (typeof updateContextUsageDisplay === "function")
        updateContextUsageDisplay(null);

      fetchAndDisplaySessions();

      console.log(
        "MAIN_CTRL: Initial UI state updated from /api/status response.",
      );
    },
    error: function () {
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
  apiFetchSessions()
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
    .fail(function () {
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
      $logsDisplay.text(
        response.logs ||
          response.error ||
          "No log content received or empty log file.",
      );
      $logsDisplay.scrollTop($logsDisplay[0].scrollHeight);
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
  initializeTheme();
  fetchAndUpdateInitialStatus();

  // Initialize event listeners from all UI modules
  [
    initChatEventListeners,
    initRagEventListeners,
    initLlmSettingsEventListeners,
    initContextManagerEventListeners,
    initPromptTemplateEventListeners,
    initIngestionEventListeners,
  ].forEach((initFunc) => {
    if (typeof initFunc === "function") initFunc();
  });

  // --- Theme Switcher Event Listener ---
  $(".dropdown-menu a[data-theme]").on("click", function (e) {
    e.preventDefault();
    applyTheme($(this).data("theme"));
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

        // Update global settings from the defaults sent for a new session
        if (newSessionResponse.llm_settings) {
          window.currentLlmSettings.providerName =
            newSessionResponse.llm_settings.provider_name;
          window.currentLlmSettings.modelName =
            newSessionResponse.llm_settings.model_name;
          window.currentLlmSettings.systemMessage =
            newSessionResponse.llm_settings.system_message;
        }
        // ... (update RAG, prompt values etc. similarly if needed) ...
        window.stagedContextItems = [];
        if (typeof renderStagedContextItems === "function")
          renderStagedContextItems();

        // **FIX**: Manually prepend the new session item to the UI
        $("#session-list .list-group-item.active").removeClass("active");
        const $newSessionItem = $("<a>", {
          href: "#",
          class: "list-group-item list-group-item-action active",
          "data-session-id": newSessionResponse.id,
          html: `<div class="d-flex w-100 justify-content-between">
                       <h6 class="mb-1 text-primary"><em>New Session...</em></h6>
                   </div>
                   <small class="text-muted">Messages: 0</small>`,
        });
        $("#session-list").prepend($newSessionItem);
        // Refresh the session list in the background to get proper names later
        setTimeout(fetchAndDisplaySessions, 2000);
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
        if (!response.session_data) {
          showToast("Error", "Invalid session data received.", "danger");
          return;
        }
        window.currentLlmSessionId = response.session_data.id;
        updateChatPanelState(true);

        $("#chat-messages").empty();
        if (
          response.session_data.messages &&
          response.session_data.messages.length > 0
        ) {
          response.session_data.messages.forEach((msg) => {
            if (typeof appendMessageToChat === "function")
              appendMessageToChat(msg.content, msg.role, false, msg.id);
          });
        }
        // Reload all settings and session list to reflect the loaded session's state
        fetchAndUpdateInitialStatus();
      })
      .fail(function () {
        showToast("Error", "Failed to load session.", "danger");
      });
  });

  // --- Per-Session Delete Button ---
  $("#session-list").on("click", ".btn-delete-session-item", function (e) {
    e.preventDefault();
    e.stopPropagation();
    const sessionIdToDelete = $(this).data("session-id");
    if (!sessionIdToDelete) return;

    showToast(
      "Confirm",
      `Delete session ${sessionIdToDelete}? This cannot be undone.`,
      "warning",
      true,
      function (confirmed) {
        if (confirmed) {
          apiDeleteSession(sessionIdToDelete).done(function (response) {
            showToast(
              "Success",
              response.message || "Session deleted.",
              "success",
            );
            if (window.currentLlmSessionId === sessionIdToDelete) {
              window.currentLlmSessionId = null;
              fetchAndUpdateInitialStatus();
            } else {
              fetchAndDisplaySessions();
            }
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

  console.log("MAIN_CTRL: LLMChat Web UI fully initialized.");
});
