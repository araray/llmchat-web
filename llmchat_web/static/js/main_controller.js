// llmchat_web/static/js/main_controller.js

/**
 * @file main_controller.js
 * @description Main JavaScript controller for the llmchat-web interface.
 * This file initializes various UI modules and handles global state management,
 * initial status fetching, session list display, and other top-level UI interactions.
 * This version includes logic for session renaming, fixes for session creation UI,
 * theme management, initialization of the prompt shortcut bar, and corrects the
 * logic for displaying chat history when a session is loaded.
 * It now programmatically loads external libraries before initializing the app
 * to provide a definitive fix for script loading race conditions.
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
 * - prompt_manager_ui.js (provides prompt management and shortcut logic)
 * - prompt_template_ui.js
 * - ingestion_ui.js
 */

// Note: Global state variables (window.currentLlmSessionId, window.stagedContextItems,
// window.currentRagSettings, window.currentLlmSettings, window.currentPromptTemplateValues)
// are DECLARED and INITIALIZED in utils.js to ensure they exist before any other script runs.
// This script (main_controller.js) will POPULATE these global variables.

// =================================================================================
// SECTION: Dynamic Script Loading (Robust Fix for Race Conditions)
// =================================================================================

/**
 * Dynamically loads a script from a given URL and returns a Promise.
 * @param {string} url The URL of the script to load.
 * @returns {Promise<void>} A promise that resolves when the script is loaded, or rejects on error.
 */
function loadScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${url}`));
    document.head.appendChild(script);
  });
}

/**
 * Loads all required external libraries in sequence before initializing the main application.
 * This provides a definitive solution to the `ReferenceError` race condition.
 */
async function loadDependenciesAndInitializeApp() {
  console.log("MAIN_CTRL: Starting dynamic library loading...");
  const libraryUrls = [
    "https://cdn.jsdelivr.net/npm/dompurify@3.1.5/dist/purify.min.js",
    "https://cdn.jsdelivr.net/npm/marked@13.0.2/marked.min.js",
    "https://cdn.jsdelivr.net/npm/marked-highlight@2.1.3/lib/index.umd.min.js",
    "https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/common.min.js",
  ];

  try {
    for (const url of libraryUrls) {
      console.log(`MAIN_CTRL: Loading ${url}...`);
      await loadScript(url);
      console.log(`MAIN_CTRL: Successfully loaded ${url}.`);
    }

    console.log(
      "MAIN_CTRL: All external libraries loaded successfully. Initializing application.",
    );

    // This is the main application entry point, now guaranteed to run after dependencies are ready.
    // Explicitly initialize the rendering pipeline first.
    if (typeof initRenderingPipeline === "function") {
      initRenderingPipeline();
    } else {
      console.error(
        "FATAL: initRenderingPipeline function not found in chat_ui.js. Rendering will fail.",
      );
      showToast(
        "Application Error",
        "Could not initialize the content rendering engine. The application may not work correctly.",
        "danger",
        false,
      );
      return; // Halt initialization
    }

    initializeTheme();
    fetchAndUpdateInitialStatus();

    // Initialize event listeners from all UI modules
    [
      initChatEventListeners,
      initRagEventListeners,
      initLlmSettingsEventListeners,
      initContextManagerEventListeners,
      initPromptManagerEventListeners,
      initPromptTemplateEventListeners,
      initIngestionEventListeners,
    ].forEach((initFunc) => {
      if (typeof initFunc === "function") initFunc();
    });

    // After all modules are initialized, render the quick prompt bar from localStorage favorites
    if (typeof renderQuickPromptBar === "function") {
      renderQuickPromptBar();
    }
  } catch (error) {
    console.error("FATAL: A critical library failed to load.", error);
    showToast(
      "Application Error",
      `A critical library failed to load: ${error.message}. Please refresh the page.`,
      "danger",
      false,
    );
  }
}

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

      // Update context usage display with data from status response
      if (typeof updateContextUsageDisplay === "function") {
        // The /api/status endpoint now returns the last known context usage.
        // We store this in our global state to act as the baseline for the live counter.
        window.lastBaseContextUsage = status.context_usage; // Can be null
        updateContextUsageDisplay(window.lastBaseContextUsage);
      }

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
 * --- Rationale Block: fix(ui): Ensure new session card persists ---
 * Pre-state: Clicking "New Session" prepended a temporary DOM element to the
 * session list and used a `setTimeout` to refresh the list from the
 * backend after 2 seconds.
 * Limitation: This was a race condition. If the user didn't send a message
 * within 2 seconds to persist the session, the refresh would fetch
 * the session list from the backend (which didn't include the new
 * transient session), causing the new session card to disappear from the UI.
 * Decision Path: The logic is refactored to implement a robust "optimistic update".
 * 1. The `fetchAndDisplaySessions` function is split into a data-fetching
 * part (`fetchAndDisplaySessions`) and a pure rendering part (`renderSessionList`).
 * 2. The "New Session" click handler is modified. Instead of adding a DOM element
 * directly, it first creates the new transient session via the API.
 * 3. Then, it fetches the current list of *persistent* sessions from the backend.
 * 4. It creates a placeholder JavaScript object for the new transient session
 * and prepends it to the array of persistent sessions.
 * 5. Finally, it calls the new `renderSessionList` function with this combined
 * array, which atomically updates the entire session list in the DOM.
 * Post-state: The new session card appears immediately and remains visible, as its
 * display is now managed by the client-side state until the next full
 * refresh after the session is naturally persisted. This eliminates the
 * race condition and the need for the `setTimeout` hack.
 */

/**
 * Renders a list of session objects into the session list UI.
 * @param {Array<Object>} sessions - An array of session metadata objects.
 * @param {string|null} activeSessionId - The ID of the session to mark as active.
 */
function renderSessionList(sessions, activeSessionId) {
  const $sessionList = $("#session-list").empty();
  if (sessions && sessions.length > 0) {
    sessions.forEach(function (session) {
      const buttonsHtml = `
            <div class="btn-group" role="group">
                <button class="btn btn-sm btn-outline-secondary btn-rename-session-item" data-session-id="${escapeHtml(session.id)}" title="Rename Session">
                    <i class="fas fa-pencil-alt fa-xs"></i>
                </button>
                <button class="btn btn-sm btn-outline-danger btn-delete-session-item" data-session-id="${escapeHtml(session.id)}" title="Delete Session">
                    <i class="fas fa-trash-alt fa-xs"></i>
                </button>
            </div>`;

      const $sessionItem = $("<a>", {
        href: "#",
        class:
          "list-group-item list-group-item-action d-flex justify-content-between align-items-center",
        "data-session-id": session.id,
        html: `<div>
                       <div class="fw-bold session-name-display">${escapeHtml(session.name) || escapeHtml(session.id.substring(0, 15)) + "..."}</div>
                       <small class="text-muted">Messages: ${session.message_count || 0}</small>
                   </div>
                   ${buttonsHtml}`,
      });

      if (session.id === activeSessionId) {
        $sessionItem.addClass("active");
      }
      $sessionList.append($sessionItem);
    });
  } else {
    $sessionList.append(
      '<p class="text-muted small m-2">No saved sessions found.</p>',
    );
  }
}

/**
 * Fetches the list of saved sessions from the backend and renders them.
 */
function fetchAndDisplaySessions() {
  apiFetchSessions()
    .done(function (sessions) {
      renderSessionList(sessions, window.currentLlmSessionId);
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
  // Start the application by dynamically loading dependencies and then initializing.
  loadDependenciesAndInitializeApp();

  // Event listeners that don't depend on the dynamically loaded libraries can be placed here,
  // though it's often cleaner to keep all initialization logic together.
  // We will bind them after successful library loading.

  // --- Theme Switcher Event Listener ---
  $(".dropdown-menu a[data-theme]").on("click", function (e) {
    e.preventDefault();
    applyTheme($(this).data("theme"));
  });

  // --- New Session Button ---
  $("#btn-new-session").on("click", function () {
    apiCreateNewSession()
      .done(function (newSessionResponse) {
        // Update global state for the new session
        window.currentLlmSessionId = newSessionResponse.id;

        // Clear UI components for the new session
        $("#chat-messages")
          .empty()
          .append(
            '<div class="message-bubble agent-message">New session started.</div>',
          );
        updateChatPanelState(true);

        // Reset settings based on the response from the 'new' endpoint
        if (newSessionResponse.llm_settings) {
          window.currentLlmSettings.providerName =
            newSessionResponse.llm_settings.provider_name;
          window.currentLlmSettings.modelName =
            newSessionResponse.llm_settings.model_name;
          window.currentLlmSettings.systemMessage =
            newSessionResponse.llm_settings.system_message;
        }
        window.stagedContextItems = [];
        if (typeof renderStagedContextItems === "function")
          renderStagedContextItems();

        window.lastBaseContextUsage = null;
        updateContextUsageDisplay(null);

        // Perform optimistic UI update for the session list
        apiFetchSessions().done(function (existingSessions) {
          const newSessionPlaceholder = {
            id: newSessionResponse.id,
            name: "New Session...", // Use a placeholder name
            message_count: 0,
            updated_at: new Date().toISOString(),
          };

          // Prepend the new session placeholder to the fetched list
          const combinedSessions = [newSessionPlaceholder, ...existingSessions];

          // Render the updated list
          renderSessionList(combinedSessions, newSessionResponse.id);
        });
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

        // --- START: FIX-1.4-REVISED: Robust UI Update on Session Load ---
        console.log(
          `MAIN_CTRL: Loading session ${response.session_data.id}. Starting UI updates.`,
        );

        // 1. Update all global state variables first. This is a safe, non-DOM operation.
        window.currentLlmSessionId = response.session_data.id;
        const settings = response.applied_settings;
        window.currentLlmSettings = {
          providerName: settings.current_provider_name,
          modelName: settings.current_model_name,
          systemMessage: settings.system_message,
        };
        window.currentRagSettings = {
          enabled: settings.rag_enabled,
          collectionName: settings.rag_collection_name,
          kValue: settings.k_value,
          filter: settings.rag_filter,
        };
        window.currentPromptTemplateValues = settings.prompt_template_values;
        window.stagedContextItems = []; // Staged items are transient, so clear them on load.
        window.lastBaseContextUsage = response.context_usage; // Can be null
        console.log("MAIN_CTRL: Global state updated for loaded session.");

        // 2. Update all peripheral UI components that rely on the new global state.
        // This is done before touching the chat panel to avoid race conditions or resets.
        updateChatPanelState(true);
        $("#status-provider").text(
          window.currentLlmSettings.providerName || "N/A",
        );
        $("#status-model").text(window.currentLlmSettings.modelName || "N/A");

        if (typeof updateContextUsageDisplay === "function")
          updateContextUsageDisplay(window.lastBaseContextUsage);
        if (typeof updateRagControlsState === "function")
          updateRagControlsState();
        if (typeof fetchAndPopulateRagCollections === "function")
          fetchAndPopulateRagCollections();
        if (typeof fetchAndPopulateLlmProviders === "function")
          fetchAndPopulateLlmProviders();
        if (typeof fetchAndDisplaySystemMessage === "function")
          fetchAndDisplaySystemMessage();
        if (typeof fetchAndDisplayPromptTemplateValues === "function")
          fetchAndDisplayPromptTemplateValues();
        if (typeof renderStagedContextItems === "function")
          renderStagedContextItems();
        console.log("MAIN_CTRL: Peripheral UI components updated.");

        // 3. Refresh the session list to correctly highlight the newly active session.
        fetchAndDisplaySessions();
        console.log("MAIN_CTRL: Session list refreshed.");

        // 4. Finally, render the chat messages. This is the last and most critical DOM operation.
        const $chatPanel = $("#chat-messages");
        $chatPanel.empty();
        console.log(
          `MAIN_CTRL: Chat panel emptied. Preparing to render ${response.session_data.messages.length} messages.`,
        );

        if (
          response.session_data.messages &&
          response.session_data.messages.length > 0
        ) {
          response.session_data.messages.forEach((msg) => {
            if (typeof appendMessageToChat === "function") {
              appendMessageToChat(msg.content, msg.role, false, msg.id);
            }
          });
          console.log(
            `MAIN_CTRL: Finished rendering messages. Final child count: ${$chatPanel.children().length}`,
          );
        } else {
          $chatPanel.append(
            '<p class="text-muted text-center small p-3">This session is empty.</p>',
          );
          console.log("MAIN_CTRL: Rendered 'session is empty' message.");
        }
        // --- END: FIX-1.4-REVISED ---
      })
      .fail(function () {
        showToast("Error", "Failed to load session.", "danger");
      });
  });

  // --- Per-Session Rename Button ---
  $("#session-list").on("click", ".btn-rename-session-item", function (e) {
    e.preventDefault();
    e.stopPropagation(); // Prevent the session load event from firing

    const sessionIdToRename = $(this).data("session-id");
    const currentName = $(this)
      .closest(".list-group-item")
      .find(".session-name-display")
      .text();

    if (!sessionIdToRename) return;

    const newName = prompt(
      "Enter the new name for the session:",
      currentName.endsWith("...") ? "" : currentName,
    );

    if (newName && newName.trim() !== "" && newName.trim() !== currentName) {
      apiRenameSession(sessionIdToRename, newName.trim())
        .done(function (response) {
          showToast(
            "Success",
            response.message || "Session renamed successfully.",
            "success",
          );
          fetchAndDisplaySessions(); // Refresh the list to show the new name
        })
        .fail(function (jqXHR) {
          const errorMsg =
            jqXHR.responseJSON?.error || "Failed to rename session.";
          showToast("Error", errorMsg, "danger");
        });
    } else if (newName !== null) {
      // User didn't cancel but entered empty or same name
      showToast("Info", "Session name was not changed.", "info");
    }
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
              $("#chat-messages")
                .empty()
                .append(
                  '<div class="message-bubble agent-message">Session deleted. Please start or load a new session.</div>',
                );
              updateChatPanelState(false);
              fetchAndUpdateInitialStatus(); // Full refresh to reset to defaults
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
