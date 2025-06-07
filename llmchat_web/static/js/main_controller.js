// llmchat_web/static/js/main_controller.js

/**
 * @file main_controller.js
 * @description Main JavaScript controller for the llmchat-web interface.
 * This file initializes various UI modules and handles global state management,
 * initial status fetching, session list display, log display, and remaining top-level UI interactions.
 *
 * Global state variables (e.g., window.currentLlmSettings) are initialized in utils.js.
 * This script populates them based on backend status and user interactions.
 *
 * As part of the Phase 2 UI refactoring, the dedicated "Logs" tab and its event handler have been removed.
 * Log viewing is now handled via a modal triggered by a button in the "Settings" pane.
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

      // Ensure global settings objects are initialized if they became undefined
      if (
        typeof window.currentLlmSettings === "undefined" ||
        window.currentLlmSettings === null
      ) {
        console.warn(
          "MAIN_CTRL: window.currentLlmSettings was undefined, re-initializing.",
        );
        window.currentLlmSettings = {
          providerName: null,
          modelName: null,
          systemMessage: "",
        };
      }
      if (
        typeof window.currentRagSettings === "undefined" ||
        window.currentRagSettings === null
      ) {
        console.warn(
          "MAIN_CTRL: window.currentRagSettings was undefined, re-initializing.",
        );
        window.currentRagSettings = {
          enabled: false,
          collectionName: null,
          kValue: 3,
          filter: null,
        };
      }
      if (
        typeof window.currentPromptTemplateValues === "undefined" ||
        window.currentPromptTemplateValues === null
      ) {
        console.warn(
          "MAIN_CTRL: window.currentPromptTemplateValues was undefined, re-initializing.",
        );
        window.currentPromptTemplateValues = {};
      }

      window.currentLlmSettings.providerName = status.current_provider || null;
      window.currentLlmSettings.modelName = status.current_model || null;
      window.currentLlmSettings.systemMessage = status.system_message || "";
      $("#status-provider").text(
        window.currentLlmSettings.providerName || "N/A",
      );
      $("#status-model").text(window.currentLlmSettings.modelName || "N/A");
      if (typeof fetchAndPopulateLlmProviders === "function")
        fetchAndPopulateLlmProviders(); // Will use the updated global
      if (typeof fetchAndDisplaySystemMessage === "function")
        fetchAndDisplaySystemMessage(); // Will use the updated global

      window.currentRagSettings.enabled = status.rag_enabled || false;
      window.currentRagSettings.collectionName =
        status.rag_collection_name || null;
      window.currentRagSettings.kValue = status.rag_k_value || 3;
      window.currentRagSettings.filter = status.rag_filter || null; // Already handles null
      if (typeof updateRagControlsState === "function")
        updateRagControlsState(); // Uses global
      if (typeof fetchAndPopulateRagCollections === "function")
        fetchAndPopulateRagCollections(); // Uses global

      window.currentPromptTemplateValues = status.prompt_template_values || {};
      if (typeof fetchAndDisplayPromptTemplateValues === "function")
        fetchAndDisplayPromptTemplateValues(); // Uses global

      if (typeof updateContextUsageDisplay === "function")
        updateContextUsageDisplay(null); // Initialize

      fetchAndDisplaySessions(); // Updates session list and active session styles

      // Initialize UI based on whether a session is active
      if (window.currentLlmSessionId) {
        if (
          $("#context-manager-tab-btn").hasClass("active") &&
          typeof fetchAndDisplayWorkspaceItems === "function"
        ) {
          fetchAndDisplayWorkspaceItems();
        }
        if (typeof renderStagedContextItems === "function")
          renderStagedContextItems(); // Uses global stagedContextItems
      } else {
        // Clear UI elements that depend on an active session
        $("#chat-messages")
          .empty()
          .append(
            '&lt;div class="message-bubble agent-message"&gt;No active session. Create or load one.&lt;/div&gt;',
          );
        $("#workspace-items-list").html(
          '&lt;p class="text-muted p-2"&gt;No active session to load workspace items from.&lt;/p&gt;',
        );
        $("#active-context-spec-list").html(
          '&lt;p class="text-muted p-2"&gt;No active session for context items.&lt;/p&gt;',
        );
        window.stagedContextItems = []; // Clear staged items for new/no session
        if (typeof renderStagedContextItems === "function")
          renderStagedContextItems();
      }

      $("#status-coworker")
        .text("OFF")
        .removeClass("bg-success")
        .addClass("bg-danger"); // Placeholder for coworker status

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
      $("#status-provider").text("Error").addClass("text-danger");
      $("#status-model").text("Error").addClass("text-danger");
      $("#status-rag").text("Error").addClass("text-danger");
      $("#llmcore-status-sidebar")
        .removeClass("bg-success bg-warning")
        .addClass("bg-danger")
        .text("Error");
      showToast(
        "Initialization Error",
        "Could not fetch initial server status. Some features may not work.",
        "danger",
      );
    },
  });
}

/**
 * Fetches and displays the list of saved sessions.
 * Highlights the currentLlmSessionId if active.
 */
function fetchAndDisplaySessions() {
  console.log("MAIN_CTRL: Fetching sessions via apiFetchSessions...");
  apiFetchSessions() // from session_api.js
    .done(function (sessions) {
      const $sessionList = $("#session-list").empty();
      if (sessions && sessions.length > 0) {
        sessions.forEach(function (session) {
          const $sessionItem = $("&lt;a&gt;", {
            href: "#",
            class: "list-group-item list-group-item-action",
            "data-session-id": session.id,
            html: `&lt;div class="d-flex w-100 justify-content-between"&gt;
                                   &lt;h6 class="mb-1"&gt;${escapeHtml(session.name) || escapeHtml(session.id.substring(0, 15)) + "..."}&lt;/h6&gt;
                                   &lt;small class="text-muted"&gt;${new Date(session.updated_at).toLocaleString()}&lt;/small&gt;
                               &lt;/div&gt;
                               &lt;small class="text-muted"&gt;Messages: ${session.message_count || 0}&lt;/small&gt;`,
          });
          if (session.id === window.currentLlmSessionId) {
            $sessionItem.addClass("active");
            $("#btn-delete-session").prop("disabled", false);
          }
          $sessionList.append($sessionItem);
        });
        if (!window.currentLlmSessionId) {
          // Disable delete if no session is active
          $("#btn-delete-session").prop("disabled", true);
        }
      } else {
        $sessionList.append(
          '&lt;p class="text-muted small m-2"&gt;No saved sessions found.&lt;/p&gt;',
        );
        $("#btn-delete-session").prop("disabled", true);
      }
    })
    .fail(function (jqXHR, textStatus, errorThrown) {
      console.error(
        "MAIN_CTRL: Error fetching sessions:",
        textStatus,
        errorThrown,
      );
      $("#session-list").html(
        '&lt;p class="text-danger small m-2"&gt;Error loading sessions.&lt;/p&gt;',
      );
      $("#btn-delete-session").prop("disabled", true);
    });
}

/**
 * Fetches application logs from the backend and displays them in the designated element.
 * This function is now generic and populates any target element, making it suitable for the new logs modal.
 */
function fetchAndDisplayAppLogs() {
  const $logsDisplay = $("#app-logs-display"); // This ID is inside the modal
  $logsDisplay.text("Fetching logs..."); // Placeholder while loading
  console.log("MAIN_CTRL: Fetching application logs...");

  $.ajax({
    url: "/api/logs", // The endpoint for fetching logs
    type: "GET",
    dataType: "json",
    success: function (response) {
      if (response.logs) {
        $logsDisplay.text(response.logs);
        // Scroll to the bottom of the logs
        $logsDisplay.scrollTop($logsDisplay[0].scrollHeight);
      } else if (response.error) {
        $logsDisplay.text(`Error fetching logs: ${escapeHtml(response.error)}`);
        showToast("Log Error", response.error, "warning");
      } else {
        $logsDisplay.text("No log content received or empty log file.");
      }
    },
    error: function (jqXHR, textStatus, errorThrown) {
      console.error(
        "MAIN_CTRL: Error fetching application logs:",
        textStatus,
        errorThrown,
        jqXHR.responseText,
      );
      const errorMsg = jqXHR.responseJSON
        ? jqXHR.responseJSON.error
        : "Failed to fetch logs from server.";
      $logsDisplay.text(`Error: ${escapeHtml(errorMsg)}`);
      showToast("Log Fetch Error", errorMsg, "danger");
    },
  });
}

$(document).ready(function () {
  console.log("MAIN_CTRL: Document ready. Initializing application...");

  if ($("#toast-container").length === 0) {
    // Ensure toast container exists
    $("body").append(
      '&lt;div id="toast-container" class="toast-container position-fixed top-0 end-0 p-3" style="z-index: 1056"&gt;&lt;/div&gt;',
    );
  }

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

  // --- New Session Button ---
  $("#btn-new-session").on("click", function () {
    console.log("MAIN_CTRL: New session button clicked.");
    apiCreateNewSession() // from session_api.js
      .done(function (newSessionResponse) {
        // --- Rationale Block: UX-01 Fix ---
        // Pre-state: After creating a new session, the UI called `fetchAndDisplaySessions()`.
        //            Since the new session isn't persistent until the first message, it wouldn't
        //            appear in the list, making the UI feel unresponsive.
        // Limitation: The user had no immediate visual confirmation that a new session context was active.
        // Decision Path: Instead of refreshing the entire list from the backend, we now manually
        //                prepend a temporary "New Session" item to the top of the list and mark it as active.
        //                The full list refresh will happen naturally after the first message makes the
        //                session persistent or when the page is reloaded.
        // Post-state: Clicking "New Session" provides immediate, responsive feedback by adding the
        //             new session to the UI list instantly.
        // --- End Rationale Block ---
        console.log(
          "MAIN_CTRL: New session context created by API:",
          newSessionResponse,
        );
        window.currentLlmSessionId = newSessionResponse.id;
        $("#chat-messages")
          .empty()
          .append(
            '&lt;div class="message-bubble agent-message"&gt;New session started.&lt;/div&gt;',
          );

        // Deactivate any currently active session in the UI
        $("#session-list .list-group-item.active").removeClass("active");

        // Manually prepend the new, temporary session to the list UI
        const newSessionId = newSessionResponse.id;
        const $newSessionItem = $("&lt;a&gt;", {
          href: "#",
          class: "list-group-item list-group-item-action active", // Mark as active
          "data-session-id": newSessionId,
          html: `&lt;div class="d-flex w-100 justify-content-between"&gt;
                       &lt;h6 class="mb-1 text-primary"&gt;&lt;em&gt;New Session...&lt;/em&gt;&lt;/h6&gt;
                       &lt;small class="text-muted"&gt;Just now&lt;/small&gt;
                   &lt;/div&gt;
                   &lt;small class="text-muted"&gt;Messages: 0&lt;/small&gt;`,
        });
        $("#session-list").prepend($newSessionItem);

        // Update global state and UI from newSessionResponse which contains *default* settings
        if (
          typeof window.currentLlmSettings === "undefined" ||
          window.currentLlmSettings === null
        )
          window.currentLlmSettings = {};
        if (
          typeof window.currentRagSettings === "undefined" ||
          window.currentRagSettings === null
        )
          window.currentRagSettings = {};
        if (
          typeof window.currentPromptTemplateValues === "undefined" ||
          window.currentPromptTemplateValues === null
        )
          window.currentPromptTemplateValues = {};

        if (newSessionResponse.llm_settings) {
          window.currentLlmSettings.providerName =
            newSessionResponse.llm_settings.provider_name;
          window.currentLlmSettings.modelName =
            newSessionResponse.llm_settings.model_name;
          window.currentLlmSettings.systemMessage =
            newSessionResponse.llm_settings.system_message;
        }
        if (newSessionResponse.rag_settings) {
          window.currentRagSettings.enabled =
            newSessionResponse.rag_settings.enabled;
          window.currentRagSettings.collectionName =
            newSessionResponse.rag_settings.collection_name;
          window.currentRagSettings.kValue =
            newSessionResponse.rag_settings.k_value;
          window.currentRagSettings.filter =
            newSessionResponse.rag_settings.filter;
        }
        window.currentPromptTemplateValues =
          newSessionResponse.prompt_template_values || {};

        // DO NOT call fetchAndDisplaySessions(); it would wipe the prepended item.
        // The list will refresh on next full load or after a persistent action.

        if (typeof updateRagControlsState === "function")
          updateRagControlsState();
        if (typeof fetchAndPopulateLlmProviders === "function")
          fetchAndPopulateLlmProviders(); // This will re-select based on new global
        if (typeof fetchAndDisplaySystemMessage === "function")
          fetchAndDisplaySystemMessage();
        if (typeof fetchAndDisplayPromptTemplateValues === "function")
          fetchAndDisplayPromptTemplateValues();
        if (typeof updateContextUsageDisplay === "function")
          updateContextUsageDisplay(null);

        window.stagedContextItems = []; // Clear any client-side staged items
        if (typeof renderStagedContextItems === "function")
          renderStagedContextItems();
        if (
          typeof fetchAndDisplayWorkspaceItems === "function" &&
          $("#context-manager-tab-btn").hasClass("active")
        ) {
          fetchAndDisplayWorkspaceItems(); // Workspace for new session will be empty
        }
        $("#btn-delete-session").prop("disabled", true); // New session is not yet persistent
        // Update status bar
        $("#status-provider").text(
          window.currentLlmSettings.providerName || "N/A",
        );
        $("#status-model").text(window.currentLlmSettings.modelName || "N/A");
        if (typeof updateRagStatusDisplay === "function")
          updateRagStatusDisplay(); // If rag_ui has this
        else if (typeof updateRagControlsState === "function")
          updateRagControlsState(); // This also updates display
      })
      .fail(function (jqXHR, textStatus, errorThrown) {
        console.error(
          "MAIN_CTRL: Error creating new session context:",
          textStatus,
          errorThrown,
        );
        showToast("Error", "Failed to create new session context.", "danger");
      });
  });

  // --- Load Session from List ---
  $("#session-list").on("click", ".list-group-item", function (e) {
    e.preventDefault();
    const sessionIdToLoad = $(this).data("session-id");
    if (sessionIdToLoad === window.currentLlmSessionId) {
      showToast("Info", "This session is already active.", "info");
      return;
    }
    console.log(`MAIN_CTRL: Loading session: ${sessionIdToLoad}`);
    apiLoadSession(sessionIdToLoad) // from session_api.js
      .done(function (response) {
        console.log("MAIN_CTRL: Session loaded response:", response);
        const loadedSessionData = response.session_data;
        const appliedSettings = response.applied_settings; // Settings now reflect what's in Flask session after load
        if (!loadedSessionData) {
          showToast("Error", "Invalid session data received.", "danger");
          return;
        }
        window.currentLlmSessionId = loadedSessionData.id;
        $("#chat-messages").empty();
        if (
          loadedSessionData.messages &&
          loadedSessionData.messages.length > 0
        ) {
          loadedSessionData.messages.forEach((msg) => {
            if (typeof appendMessageToChat === "function")
              appendMessageToChat(msg.content, msg.role, false, msg.id);
          });
        } else {
          $("#chat-messages").append(
            '&lt;div class="message-bubble agent-message"&gt;Session loaded. No messages yet.&lt;/div&gt;',
          );
        }

        // Update global JS state variables from `applied_settings` (which reflect Flask session after load)
        if (
          typeof window.currentLlmSettings === "undefined" ||
          window.currentLlmSettings === null
        )
          window.currentLlmSettings = {};
        if (
          typeof window.currentRagSettings === "undefined" ||
          window.currentRagSettings === null
        )
          window.currentRagSettings = {};
        if (
          typeof window.currentPromptTemplateValues === "undefined" ||
          window.currentPromptTemplateValues === null
        )
          window.currentPromptTemplateValues = {};

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
          window.currentRagSettings.kValue = appliedSettings.k_value; // Ensure key matches what's sent from backend
          window.currentRagSettings.filter = appliedSettings.rag_filter;

          window.currentPromptTemplateValues =
            appliedSettings.prompt_template_values || {};
        }

        fetchAndDisplaySessions(); // Refresh list to show active state
        // Update UI controls and status bar based on the new global state
        $("#status-provider").text(
          window.currentLlmSettings.providerName || "N/A",
        );
        $("#status-model").text(window.currentLlmSettings.modelName || "N/A");

        if (typeof fetchAndPopulateLlmProviders === "function")
          fetchAndPopulateLlmProviders(); // Will re-select based on global
        if (typeof fetchAndDisplaySystemMessage === "function")
          fetchAndDisplaySystemMessage();
        if (typeof updateRagControlsState === "function")
          updateRagControlsState();
        if (typeof fetchAndPopulateRagCollections === "function")
          fetchAndPopulateRagCollections();
        if (typeof fetchAndDisplayPromptTemplateValues === "function")
          fetchAndDisplayPromptTemplateValues();
        if (typeof updateContextUsageDisplay === "function")
          updateContextUsageDisplay(null); // Reset context usage for new session

        window.stagedContextItems = []; // Clear client-side staged items when loading a session
        if (typeof renderStagedContextItems === "function")
          renderStagedContextItems();
        if (
          typeof fetchAndDisplayWorkspaceItems === "function" &&
          $("#context-manager-tab-btn").hasClass("active")
        )
          fetchAndDisplayWorkspaceItems(); // Load workspace for the newly loaded session
      })
      .fail(function (jqXHR, textStatus, errorThrown) {
        console.error(
          "MAIN_CTRL: Error loading session:",
          textStatus,
          errorThrown,
        );
        showToast("Error", "Failed to load session.", "danger");
      });
  });

  // --- Delete Session Button ---
  $("#btn-delete-session").on("click", function () {
    if (!window.currentLlmSessionId || $(this).prop("disabled")) return;
    showToast(
      "Confirm",
      `Delete session ${window.currentLlmSessionId}? This cannot be undone.`,
      "warning",
      true,
      function (confirmed) {
        if (confirmed) {
          console.log(
            `MAIN_CTRL: Deleting session: ${window.currentLlmSessionId}`,
          );
          apiDeleteSession(window.currentLlmSessionId) // from session_api.js
            .done(function (response) {
              console.log("MAIN_CTRL: Session delete response:", response);
              showToast(
                "Success",
                response.message || "Session deleted.",
                "success",
              );
              window.currentLlmSessionId = null; // Clear current session ID
              // Effectively, trigger a "new session" like state for the UI
              fetchAndUpdateInitialStatus(); // This will reset globals and UI to defaults
            })
            .fail(function (jqXHR, textStatus, errorThrown) {
              console.error(
                "MAIN_CTRL: Error deleting session:",
                textStatus,
                errorThrown,
              );
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

  // --- Rationale Block: [UI-01] Logs Modal Implementation ---
  // Pre-state: A 'shown.bs.tab' event handler existed for a "#logs-tab-btn", which
  //            populated a dedicated "Logs" tab pane.
  // Limitation: The UI specification (spec2.md) required removing the "Logs" tab
  //             to de-clutter the interface.
  // Decision Path: The old event handler for the non-existent tab is removed.
  //                A new event handler is created for the "#btn-view-app-logs" button,
  //                which is now located in the "Settings" pane. This new handler
  //                calls the existing `fetchAndDisplayAppLogs` function (which already
  //                targets the correct element inside the modal) and then programmatically
  //                shows the Bootstrap modal for logs.
  // Post-state: The "Logs" tab logic is gone. Clicking the "View Application Logs"
  //             button in the settings pane now correctly fetches logs and displays
  //             them in the `#appLogsModal` as required.
  // --- End Rationale Block ---

  // New event handler for the "View Application Logs" button in the Settings pane
  $("#btn-view-app-logs").on("click", function () {
    console.log(
      "MAIN_CTRL: View App Logs button clicked. Fetching logs for modal...",
    );
    // The fetchAndDisplayAppLogs function already targets the modal's content area
    fetchAndDisplayAppLogs();
    // Manually trigger the modal to show
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
    // Initial call
    updateChatInputTokenEstimate();

  // --- REPL Command Input ---
  // This is a placeholder for a future feature and is not part of the current core UI flow.
  // It has been removed from the visible UI in index.html for the Phase 2 refactor,
  // but the logic is kept here in case it's reinstated.
  $("#repl-command-input").on("keypress", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      const commandText = $(this).val().trim();
      if (commandText) {
        console.log("MAIN_CTRL: REPL command to send:", commandText);
        $("#repl-command-output").prepend(
          // Add to top
          `&lt;div class="text-info"&gt;&lt;i class="fas fa-angle-right"&gt;&lt;/i&gt; ${escapeHtml(commandText)}&lt;/div&gt;`,
        );
        $(this).val(""); // Clear input
        $.ajax({
          url: "/api/command",
          type: "POST",
          contentType: "application/json",
          data: JSON.stringify({ command: commandText }),
          dataType: "json",
          success: function (response) {
            console.log("MAIN_CTRL: REPL command response:", response);
            let outputHtml = `&lt;div class="${response.status === "error" ? "text-danger" : response.status === "executed" ? "text-success" : "text-white-50"}"&gt;`;
            if (response.output)
              outputHtml += `&lt;i class="fas fa-check-circle"&gt;&lt;/i&gt; ${escapeHtml(response.output)}`;
            else if (response.command_received)
              outputHtml += `&lt;i class="fas fa-check-circle"&gt;&lt;/i&gt; Command '${escapeHtml(response.command_received)}' acknowledged. Status: ${escapeHtml(response.status || "unknown")}`;
            else
              outputHtml += `&lt;i class="fas fa-info-circle"&gt;&lt;/i&gt; Empty response from server.`;
            outputHtml += `&lt;/div&gt;`;
            $("#repl-command-output").prepend(outputHtml);
            // Limit number of output lines in REPL
            const maxReplLines = 50;
            while ($("#repl-command-output div").length > maxReplLines) {
              $("#repl-command-output div:last-child").remove();
            }
          },
          error: function (jqXHR, textStatus, errorThrown) {
            console.error(
              "MAIN_CTRL: REPL command error:",
              textStatus,
              errorThrown,
            );
            const errorMsg = jqXHR.responseJSON
              ? jqXHR.responseJSON.error
              : "Failed to send command.";
            $("#repl-command-output").prepend(
              `&lt;div class="text-danger"&gt;&lt;i class="fas fa-exclamation-triangle"&gt;&lt;/i&gt; Error: ${escapeHtml(errorMsg)}&lt;/div&gt;`,
            );
          },
        });
      }
    }
  });
  console.log("MAIN_CTRL: LLMChat Web UI fully initialized.");
});
