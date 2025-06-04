// llmchat_web/static/js/custom.js

/**
 * @file custom.js
 * @description Custom JavaScript and jQuery for the llmchat-web interface.
 * This file handles client-side logic for session management (not API calls),
 * and basic command tab interaction. It also initializes all other UI modules.
 *
 * Utility functions (escapeHtml, showToast) are in utils.js.
 * Session API call functions (apiFetchSessions, etc.) are in session_api.js.
 * Chat message UI and interaction logic are in chat_ui.js.
 * RAG UI logic is in rag_ui.js.
 * LLM Settings UI logic is in llm_settings_ui.js.
 * Context Manager UI logic is in context_manager_ui.js.
 * Prompt Template Values UI logic is in prompt_template_ui.js.
 * Ingestion UI logic is in ingestion_ui.js.
 */

// Global variable to store the current LLMCore session ID for the web client
let currentLlmSessionId = null;
// Global array to store items staged for active context.
// This is accessed and modified by context_manager_ui.js and chat_ui.js.
let stagedContextItems = [];

// Global state for RAG settings (mirrors Flask session, updated via API)
// This object is accessed and potentially modified by rag_ui.js
let currentRagSettings = {
  enabled: false,
  collectionName: null,
  kValue: 3,
  filter: null,
};

// Global state for LLM settings (mirrors Flask session, updated via API)
// This object is accessed and potentially modified by llm_settings_ui.js
let currentLlmSettings = {
  providerName: null,
  modelName: null,
  systemMessage: "",
};

// Global state for Prompt Template Values (mirrors Flask session, updated via API)
// This object is accessed and potentially modified by prompt_template_ui.js
let currentPromptTemplateValues = {};

// All major UI component functions and their event listeners are now in separate files.
// This file primarily initializes them and handles any remaining global setup or minor UI interactions.

/**
 * Fetches initial status from the backend and updates the UI and global state.
 * This function is called when the DOM is ready.
 * Calls initialization functions from other modules.
 */
function fetchAndUpdateInitialStatus() {
  console.log("Fetching initial status from /api/status...");
  $.ajax({
    url: "/api/status",
    type: "GET",
    dataType: "json",
    success: function (status) {
      console.log("Initial status received:", status);

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

      currentLlmSessionId = status.current_session_id;
      console.log("Set currentLlmSessionId to:", currentLlmSessionId);

      currentLlmSettings.providerName = status.current_provider;
      currentLlmSettings.modelName = status.current_model;
      currentLlmSettings.systemMessage = status.system_message || "";
      $("#status-provider").text(currentLlmSettings.providerName || "N/A");
      $("#status-model").text(currentLlmSettings.modelName || "N/A");
      if (typeof fetchAndPopulateLlmProviders === "function")
        fetchAndPopulateLlmProviders();
      if (typeof fetchAndDisplaySystemMessage === "function")
        fetchAndDisplaySystemMessage();

      currentRagSettings.enabled = status.rag_enabled || false;
      currentRagSettings.collectionName = status.rag_collection_name;
      currentRagSettings.kValue = status.rag_k_value || 3;
      currentRagSettings.filter = status.rag_filter || null;
      if (typeof updateRagControlsState === "function")
        updateRagControlsState();
      if (typeof fetchAndPopulateRagCollections === "function")
        fetchAndPopulateRagCollections();

      currentPromptTemplateValues = status.prompt_template_values || {};
      if (typeof fetchAndDisplayPromptTemplateValues === "function")
        fetchAndDisplayPromptTemplateValues();

      updateContextUsageDisplay(null);
      fetchAndDisplaySessions(); // This function remains in custom.js

      if (currentLlmSessionId) {
        if (
          $("#context-manager-tab-btn").hasClass("active") &&
          typeof fetchAndDisplayWorkspaceItems === "function"
        ) {
          fetchAndDisplayWorkspaceItems();
        }
        if (typeof renderStagedContextItems === "function")
          renderStagedContextItems();
      } else {
        $("#workspace-items-list").html(
          '<p class="text-muted p-2">No active session. Create or load one.</p>',
        );
        $("#active-context-spec-list").html(
          '<p class="text-muted p-2">No active session for context items.</p>',
        );
      }

      $("#status-coworker")
        .text("OFF")
        .removeClass("bg-success")
        .addClass("bg-danger");

      console.log("Initial UI state updated from /api/status response.");
    },
    error: function (jqXHR, textStatus, errorThrown) {
      console.error("Error fetching initial status:", textStatus, errorThrown);
      $("#status-provider").text("Error").addClass("bg-danger");
      $("#status-model").text("Error").addClass("bg-danger");
      $("#status-rag").text("Error").addClass("bg-danger");
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
 * Fetches and displays the list of available sessions.
 * Uses apiFetchSessions from session_api.js
 */
function fetchAndDisplaySessions() {
  console.log("Fetching sessions via apiFetchSessions...");
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
      console.error("Error fetching sessions:", textStatus, errorThrown);
      $("#session-list").html(
        '<p class="text-danger small m-2">Error loading sessions.</p>',
      );
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

$(document).ready(function () {
  console.log("LLMChat Web: custom.js loaded and DOM ready.");

  if ($("#toast-container").length === 0) {
    $("body").append(
      '<div id="toast-container" class="toast-container position-fixed top-0 end-0 p-3" style="z-index: 1056"></div>',
    );
  }

  // Initialize all UI modules
  fetchAndUpdateInitialStatus(); // Fetches initial state and calls specific UI updaters

  // Call init functions from the new modules
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
  $("#btn-new-session").on("click", function () {
    console.log("New session button clicked.");
    apiCreateNewSession() // from session_api.js
      .done(function (newSessionResponse) {
        console.log("New session created:", newSessionResponse);
        currentLlmSessionId = newSessionResponse.id;
        $("#chat-messages")
          .empty()
          .append(
            '<div class="message-bubble agent-message">New session started.</div>',
          );

        if (newSessionResponse.rag_settings)
          currentRagSettings = newSessionResponse.rag_settings;
        if (newSessionResponse.llm_settings)
          currentLlmSettings = newSessionResponse.llm_settings;
        if (newSessionResponse.prompt_template_values)
          currentPromptTemplateValues =
            newSessionResponse.prompt_template_values;

        fetchAndDisplaySessions(); // from custom.js (calls session_api.js)

        // Call update/display functions from respective UI modules
        if (typeof updateRagControlsState === "function")
          updateRagControlsState();
        if (typeof fetchAndPopulateLlmProviders === "function")
          fetchAndPopulateLlmProviders();
        if (typeof fetchAndDisplaySystemMessage === "function")
          fetchAndDisplaySystemMessage();
        if (typeof fetchAndDisplayPromptTemplateValues === "function")
          fetchAndDisplayPromptTemplateValues();

        updateContextUsageDisplay(null); // from custom.js

        stagedContextItems = [];
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
        console.error("Error creating new session:", textStatus, errorThrown);
        showToast("Error", "Failed to create new session.", "danger"); // from utils.js
      });
  });

  $("#session-list").on("click", ".list-group-item", function (e) {
    e.preventDefault();
    const sessionIdToLoad = $(this).data("session-id");
    console.log(`Loading session: ${sessionIdToLoad}`);
    apiLoadSession(sessionIdToLoad) // from session_api.js
      .done(function (response) {
        console.log("Session loaded response:", response);
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
        currentLlmSessionId = loadedSessionData.id;
        $("#chat-messages").empty();
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

        fetchAndDisplaySessions(); // from custom.js
        $("#status-provider").text(currentLlmSettings.providerName || "N/A");
        $("#status-model").text(currentLlmSettings.modelName || "N/A");

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

        updateContextUsageDisplay(null); // from custom.js

        stagedContextItems = [];
        if (typeof renderStagedContextItems === "function")
          renderStagedContextItems();
        if (
          $("#context-manager-tab-btn").hasClass("active") &&
          typeof fetchAndDisplayWorkspaceItems === "function"
        ) {
          fetchAndDisplayWorkspaceItems();
        }
      })
      .fail(function (jqXHR, textStatus, errorThrown) {
        console.error("Error loading session:", textStatus, errorThrown);
        showToast("Error", "Failed to load session.", "danger");
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
          console.log(`Deleting session: ${currentLlmSessionId}`);
          apiDeleteSession(currentLlmSessionId) // from session_api.js
            .done(function (response) {
              console.log("Session delete response:", response);
              showToast(
                "Success",
                response.message || "Session deleted.",
                "success",
              );
              currentLlmSessionId = null;
              $("#chat-messages")
                .empty()
                .append(
                  '<div class="message-bubble agent-message">Session deleted. Start or load a new one.</div>',
                );
              fetchAndDisplaySessions(); // from custom.js
              fetchAndUpdateInitialStatus(); // from custom.js
              stagedContextItems = [];
              if (typeof renderStagedContextItems === "function")
                renderStagedContextItems();
              if (
                $("#context-manager-tab-btn").hasClass("active") &&
                typeof fetchAndDisplayWorkspaceItems === "function"
              ) {
                fetchAndDisplayWorkspaceItems();
              }
            })
            .fail(function (jqXHR, textStatus, errorThrown) {
              console.error("Error deleting session:", textStatus, errorThrown);
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

  // --- Settings Tab Event Handler (for parts not covered by specific UI modules) ---
  $("#settings-tab-btn").on("shown.bs.tab", function () {
    console.log(
      "Settings tab shown by custom.js. Specific UI modules handle their own updates.",
    );
    // Note: LLM settings, RAG settings, and Prompt Template Values UI updates are
    // now primarily handled within their respective init...EventListeners functions
    // when the tab is shown, or when their specific controls are interacted with.
    // fetchAndDisplayPromptTemplateValues() is called by initPromptTemplateEventListeners if settings tab is shown.
  });

  // --- Chat Input Token Estimator ---
  $("#chat-input").on("input", function () {
    updateChatInputTokenEstimate();
  });
  function updateChatInputTokenEstimate() {
    const text = $("#chat-input").val();
    const estimatedTokens = Math.ceil(text.length / 4); // Simple estimation
    $("#chat-input-token-estimate").text(`Tokens: ~${estimatedTokens}`);
  }
  updateChatInputTokenEstimate(); // Initial call

  // --- REPL Command Input Handler ---
  $("#repl-command-input").on("keypress", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      const commandText = $(this).val().trim();
      if (commandText) {
        console.log("REPL command to send:", commandText);
        $("#repl-command-output").prepend(
          `<div class="text-info"><i class="fas fa-angle-right"></i> ${escapeHtml(commandText)}</div>`,
        );
        $(this).val("");

        $.ajax({
          url: "/api/command",
          type: "POST",
          contentType: "application/json",
          data: JSON.stringify({ command: commandText }),
          dataType: "json",
          success: function (response) {
            console.log("REPL command response:", response);
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
            console.error("REPL command error:", textStatus, errorThrown);
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

  console.log(
    "LLMChat Web REPL UI initialized (client-side). All modules should be initialized.",
  );
});
