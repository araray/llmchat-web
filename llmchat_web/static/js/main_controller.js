// llmchat_web/static/js/main_controller.js

/**
 * @file main_controller.js
 * @description Main JavaScript controller for the llmchat-web interface.
 * This file initializes various UI modules and handles global state management,
 * initial status fetching, session list display, and remaining top-level UI interactions
 * like the REPL command input.
 *
 * Depends on:
 * - utils.js (for escapeHtml, showToast, updateContextUsageDisplay, updateChatInputTokenEstimate)
 * - session_api.js (for apiFetchSessions, apiCreateNewSession, etc.)
 * - chat_ui.js (for initChatEventListeners, appendMessageToChat)
 * - rag_ui.js (for initRagEventListeners, fetchAndPopulateRagCollections, updateRagControlsState)
 * - llm_settings_ui.js (for initLlmSettingsEventListeners, fetchAndPopulateLlmProviders, fetchAndDisplaySystemMessage)
 * - context_manager_ui.js (for initContextManagerEventListeners, fetchAndDisplayWorkspaceItems, renderStagedContextItems)
 * - prompt_template_ui.js (for initPromptTemplateEventListeners, fetchAndDisplayPromptTemplateValues)
 * - ingestion_ui.js (for initIngestionEventListeners)
 */

// --- Global State Variables ---
// These are defined here to be accessible by other modules loaded after utils.js but before this.
// Modules should ideally receive these as parameters or use dedicated state management if complexity grows.

/** @type {string|null} Stores the current LLMCore session ID. */
let currentLlmSessionId = null;

/** @type {Array<Object>} Stores items staged by the user for the active context.
 * Each item: {spec_item_id: string, type: string, id_ref?: string, content?: string, path?: string, no_truncate?: boolean }
 */
let stagedContextItems = [];

/** @type {Object} Stores current RAG settings.
 * Fields: {enabled: boolean, collectionName: string|null, kValue: number, filter: Object|null}
 */
let currentRagSettings = {
  enabled: false,
  collectionName: null,
  kValue: 3,
  filter: null,
};

/** @type {Object} Stores current LLM settings.
 * Fields: {providerName: string|null, modelName: string|null, systemMessage: string}
 */
let currentLlmSettings = {
  providerName: null,
  modelName: null,
  systemMessage: "",
};

/** @type {Object} Stores current Prompt Template Values.
 * Example: { "key1": "value1", "key2": "value2" }
 */
let currentPromptTemplateValues = {};

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

      // Update LLMCore status display
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
          showToast("LLMCore Error", status.llmcore_error, "danger"); // from utils.js
        }
      }

      // Update global session ID
      currentLlmSessionId = status.current_session_id;
      console.log(
        "MAIN_CTRL: Set currentLlmSessionId to:",
        currentLlmSessionId,
      );

      // Update global LLM settings and related UI
      currentLlmSettings.providerName = status.current_provider;
      currentLlmSettings.modelName = status.current_model;
      currentLlmSettings.systemMessage = status.system_message || "";
      $("#status-provider").text(currentLlmSettings.providerName || "N/A");
      $("#status-model").text(currentLlmSettings.modelName || "N/A");
      // Functions from llm_settings_ui.js will populate dropdowns and set system message input
      if (typeof fetchAndPopulateLlmProviders === "function")
        fetchAndPopulateLlmProviders();
      if (typeof fetchAndDisplaySystemMessage === "function")
        fetchAndDisplaySystemMessage();

      // Update global RAG settings and related UI
      currentRagSettings.enabled = status.rag_enabled || false;
      currentRagSettings.collectionName = status.rag_collection_name;
      currentRagSettings.kValue = status.rag_k_value || 3;
      currentRagSettings.filter = status.rag_filter || null;
      // Functions from rag_ui.js will update RAG controls and populate collections
      if (typeof updateRagControlsState === "function")
        updateRagControlsState();
      if (typeof fetchAndPopulateRagCollections === "function")
        fetchAndPopulateRagCollections();

      // Update global Prompt Template Values and related UI
      currentPromptTemplateValues = status.prompt_template_values || {};
      // Function from prompt_template_ui.js will render the table
      if (typeof fetchAndDisplayPromptTemplateValues === "function")
        fetchAndDisplayPromptTemplateValues();

      // Update context usage display (function from utils.js)
      updateContextUsageDisplay(null); // Initialize to N/A, updated after chat

      // Fetch and display session list
      fetchAndDisplaySessions();

      // Update Context Manager UI if a session is active
      if (currentLlmSessionId) {
        if (
          $("#context-manager-tab-btn").hasClass("active") &&
          typeof fetchAndDisplayWorkspaceItems === "function"
        ) {
          fetchAndDisplayWorkspaceItems(); // from context_manager_ui.js
        }
        if (typeof renderStagedContextItems === "function")
          renderStagedContextItems(); // from context_manager_ui.js
      } else {
        $("#workspace-items-list").html(
          '<p class="text-muted p-2">No active session. Create or load one.</p>',
        );
        $("#active-context-spec-list").html(
          '<p class="text-muted p-2">No active session for context items.</p>',
        );
      }

      // Update Coworker status (placeholder)
      $("#status-coworker")
        .text("OFF")
        .removeClass("bg-success")
        .addClass("bg-danger");

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
      $("#status-provider").text("Error").addClass("bg-danger");
      $("#status-model").text("Error").addClass("bg-danger");
      $("#status-rag").text("Error").addClass("bg-danger");
      $("#llmcore-status-sidebar")
        .removeClass("bg-success bg-warning")
        .addClass("bg-danger")
        .text("Error");
      showToast(
        // from utils.js
        "Initialization Error",
        "Could not fetch initial server status. Some features may not work.",
        "danger",
      );
    },
  });
}

/**
 * Fetches and displays the list of available sessions.
 * Uses apiFetchSessions from session_api.js and escapeHtml from utils.js.
 */
function fetchAndDisplaySessions() {
  console.log("MAIN_CTRL: Fetching sessions via apiFetchSessions...");
  apiFetchSessions() // From session_api.js
    .done(function (sessions) {
      const $sessionList = $("#session-list").empty();
      if (sessions && sessions.length > 0) {
        sessions.forEach(function (session) {
          const $sessionItem = $("<a>", {
            href: "#",
            class: "list-group-item list-group-item-action",
            "data-session-id": session.id,
            html: `<div class="d-flex w-100 justify-content-between">
                                   <h6 class="mb-1">${escapeHtml(session.name) || escapeHtml(session.id.substring(0, 15)) + "..."}</h6>
                                   <small class="text-muted">${new Date(session.updated_at).toLocaleString()}</small>
                               </div>
                               <small class="text-muted">Messages: ${session.message_count || 0}</small>`,
          });
          if (session.id === currentLlmSessionId) {
            $sessionItem.addClass("active");
            $("#btn-delete-session").prop("disabled", false);
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

// --- Document Ready ---
$(document).ready(function () {
  console.log("MAIN_CTRL: Document ready. Initializing application...");

  // Ensure toast container exists (moved here for early setup if utils.js doesn't create it)
  if ($("#toast-container").length === 0) {
    $("body").append(
      '<div id="toast-container" class="toast-container position-fixed top-0 end-0 p-3" style="z-index: 1056"></div>',
    );
  }

  // Fetch initial status and update UI accordingly
  fetchAndUpdateInitialStatus();

  // Initialize event listeners from all UI modules
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

  // --- Session Management Event Handlers (using session_api.js) ---
  // These handle the *results* of API calls made by session_api.js, updating global state and UI.
  $("#btn-new-session").on("click", function () {
    console.log("MAIN_CTRL: New session button clicked.");
    apiCreateNewSession() // from session_api.js
      .done(function (newSessionResponse) {
        console.log(
          "MAIN_CTRL: New session context created by API:",
          newSessionResponse,
        );
        currentLlmSessionId = newSessionResponse.id; // Update global
        $("#chat-messages") // from chat_ui.js, but direct DOM manipulation here is okay for simple reset
          .empty()
          .append(
            '<div class="message-bubble agent-message">New session started.</div>',
          );

        // Update global state objects
        if (newSessionResponse.rag_settings)
          currentRagSettings = newSessionResponse.rag_settings;
        if (newSessionResponse.llm_settings)
          currentLlmSettings = newSessionResponse.llm_settings;
        if (newSessionResponse.prompt_template_values)
          currentPromptTemplateValues =
            newSessionResponse.prompt_template_values;

        fetchAndDisplaySessions(); // Refresh session list

        // Trigger UI updates in respective modules
        if (typeof updateRagControlsState === "function")
          updateRagControlsState();
        if (typeof fetchAndPopulateLlmProviders === "function")
          fetchAndPopulateLlmProviders(); // will also call fetchAndDisplaySystemMessage
        if (typeof fetchAndDisplayPromptTemplateValues === "function")
          fetchAndDisplayPromptTemplateValues();

        updateContextUsageDisplay(null); // from utils.js

        stagedContextItems = []; // Reset global
        if (typeof renderStagedContextItems === "function")
          renderStagedContextItems(); // from context_manager_ui.js
        if (
          $("#context-manager-tab-btn").hasClass("active") &&
          typeof fetchAndDisplayWorkspaceItems === "function"
        ) {
          fetchAndDisplayWorkspaceItems(); // from context_manager_ui.js
        }
      })
      .fail(function (jqXHR, textStatus, errorThrown) {
        console.error(
          "MAIN_CTRL: Error creating new session context:",
          textStatus,
          errorThrown,
        );
        showToast("Error", "Failed to create new session context.", "danger"); // from utils.js
      });
  });

  $("#session-list").on("click", ".list-group-item", function (e) {
    e.preventDefault();
    const sessionIdToLoad = $(this).data("session-id");
    console.log(`MAIN_CTRL: Loading session: ${sessionIdToLoad}`);
    apiLoadSession(sessionIdToLoad) // from session_api.js
      .done(function (response) {
        console.log("MAIN_CTRL: Session loaded response:", response);
        const loadedSessionData = response.session_data;
        const appliedSettings = response.applied_settings;

        if (!loadedSessionData) {
          showToast(
            "Error",
            "Invalid session data received from server.",
            "danger",
          );
          return;
        }
        currentLlmSessionId = loadedSessionData.id; // Update global
        $("#chat-messages").empty(); // from chat_ui.js, direct DOM okay for reset
        if (
          loadedSessionData.messages &&
          loadedSessionData.messages.length > 0
        ) {
          loadedSessionData.messages.forEach((msg) => {
            if (typeof appendMessageToChat === "function") {
              // from chat_ui.js
              appendMessageToChat(msg.content, msg.role, false, msg.id);
            }
          });
        } else {
          $("#chat-messages").append(
            '<div class="message-bubble agent-message">Session loaded. No messages yet.</div>',
          );
        }

        // Update global state from loaded session's applied settings
        if (appliedSettings) {
          currentRagSettings = {
            enabled: appliedSettings.rag_enabled,
            collectionName: appliedSettings.rag_collection_name,
            kValue: appliedSettings.rag_k_value,
            filter: appliedSettings.rag_filter,
          };
          currentLlmSettings = {
            providerName: appliedSettings.current_provider_name,
            modelName: appliedSettings.current_model_name,
            systemMessage: appliedSettings.system_message,
          };
          currentPromptTemplateValues =
            appliedSettings.prompt_template_values || {};
        }

        fetchAndDisplaySessions(); // Refresh session list
        $("#status-provider").text(currentLlmSettings.providerName || "N/A");
        $("#status-model").text(currentLlmSettings.modelName || "N/A");

        // Trigger UI updates in respective modules
        if (typeof fetchAndPopulateLlmProviders === "function")
          fetchAndPopulateLlmProviders();
        if (typeof fetchAndDisplaySystemMessage === "function")
          fetchAndDisplaySystemMessage();
        if (typeof updateRagControlsState === "function")
          updateRagControlsState();
        if (
          $("#rag-collection-select").val() !==
            currentRagSettings.collectionName &&
          typeof fetchAndPopulateRagCollections === "function"
        ) {
          fetchAndPopulateRagCollections();
        }
        if (typeof fetchAndDisplayPromptTemplateValues === "function")
          fetchAndDisplayPromptTemplateValues();

        updateContextUsageDisplay(null); // from utils.js

        stagedContextItems = []; // Reset global
        if (typeof renderStagedContextItems === "function")
          renderStagedContextItems(); // from context_manager_ui.js
        if (
          $("#context-manager-tab-btn").hasClass("active") &&
          typeof fetchAndDisplayWorkspaceItems === "function"
        ) {
          fetchAndDisplayWorkspaceItems(); // from context_manager_ui.js
        }
      })
      .fail(function (jqXHR, textStatus, errorThrown) {
        console.error(
          "MAIN_CTRL: Error loading session:",
          textStatus,
          errorThrown,
        );
        showToast("Error", "Failed to load session.", "danger"); // from utils.js
      });
  });

  $("#btn-delete-session").on("click", function () {
    if (!currentLlmSessionId || $(this).prop("disabled")) return;
    showToast(
      // from utils.js
      "Confirm",
      `Delete session ${currentLlmSessionId}? This cannot be undone.`,
      "warning",
      true,
      function (confirmed) {
        if (confirmed) {
          console.log(`MAIN_CTRL: Deleting session: ${currentLlmSessionId}`);
          apiDeleteSession(currentLlmSessionId) // from session_api.js
            .done(function (response) {
              console.log("MAIN_CTRL: Session delete response:", response);
              showToast(
                "Success",
                response.message || "Session deleted.",
                "success",
              );
              currentLlmSessionId = null; // Update global
              $("#chat-messages") // from chat_ui.js, direct DOM okay for reset
                .empty()
                .append(
                  '<div class="message-bubble agent-message">Session deleted. Start or load a new one.</div>',
                );
              fetchAndDisplaySessions(); // Refresh list
              fetchAndUpdateInitialStatus(); // Reset to default/new state
              stagedContextItems = []; // Reset global
              if (typeof renderStagedContextItems === "function")
                renderStagedContextItems(); // from context_manager_ui.js
              if (
                $("#context-manager-tab-btn").hasClass("active") &&
                typeof fetchAndDisplayWorkspaceItems === "function"
              ) {
                fetchAndDisplayWorkspaceItems(); // from context_manager_ui.js
              }
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

  // --- Settings Tab Event Handler (minimal, specific updates handled by modules) ---
  $("#settings-tab-btn").on("shown.bs.tab", function () {
    console.log(
      "MAIN_CTRL: Settings tab shown. UI modules handle their own specific updates if needed.",
    );
    // Initialization of content within settings tab (LLM, System Msg, Prompt Values)
    // is now primarily handled by their respective UI modules' init functions
    // or by fetchAndUpdateInitialStatus which calls their display functions.
  });

  // --- Chat Input Token Estimator (event listener remains here, calls util function) ---
  $("#chat-input").on("input", function () {
    if (typeof updateChatInputTokenEstimate === "function") {
      // from utils.js
      updateChatInputTokenEstimate();
    }
  });
  if (typeof updateChatInputTokenEstimate === "function")
    updateChatInputTokenEstimate(); // Initial call

  // --- REPL Command Input Handler (remains here for now) ---
  $("#repl-command-input").on("keypress", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      const commandText = $(this).val().trim();
      if (commandText) {
        console.log("MAIN_CTRL: REPL command to send:", commandText);
        $("#repl-command-output").prepend(
          `<div class="text-info"><i class="fas fa-angle-right"></i> ${escapeHtml(commandText)}</div>`, // from utils.js
        );
        $(this).val("");

        $.ajax({
          url: "/api/command",
          type: "POST",
          contentType: "application/json",
          data: JSON.stringify({ command: commandText }),
          dataType: "json",
          success: function (response) {
            console.log("MAIN_CTRL: REPL command response:", response);
            let outputHtml = `<div class="text-success">`;
            if (response.output) {
              outputHtml += `<i class="fas fa-check-circle"></i> ${escapeHtml(response.output)}`;
            } else if (response.command_received) {
              outputHtml += `<i class="fas fa-check-circle"></i> Command '${escapeHtml(response.command_received)}' acknowledged. Status: ${escapeHtml(response.status || "unknown")}`;
            } else {
              outputHtml += `<i class="fas fa-info-circle"></i> Empty response from server.`;
            }
            outputHtml += `</div>`;
            $("#repl-command-output").prepend(outputHtml);
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
              `<div class="text-danger"><i class="fas fa-exclamation-triangle"></i> Error: ${escapeHtml(errorMsg)}</div>`,
            );
          },
        });
      }
    }
  });

  console.log("MAIN_CTRL: LLMChat Web UI fully initialized.");
});
