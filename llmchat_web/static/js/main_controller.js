// llmchat_web/static/js/main_controller.js

/**
 * @file main_controller.js
 * @description Main JavaScript controller for the llmchat-web interface.
 * This file initializes various UI modules and handles global state management,
 * initial status fetching, session list display, and remaining top-level UI interactions
 * like the REPL command input.
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
// are now DECLARED and INITIALIZED in utils.js to ensure they exist before any other script runs.
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

      updateContextUsageDisplay(null);
      fetchAndDisplaySessions();

      if (window.currentLlmSessionId) {
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

function fetchAndDisplaySessions() {
  console.log("MAIN_CTRL: Fetching sessions via apiFetchSessions...");
  apiFetchSessions()
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
          if (session.id === window.currentLlmSessionId) {
            $sessionItem.addClass("active");
            $("#btn-delete-session").prop("disabled", false);
          }
          $sessionList.append($sessionItem);
        });
        if (!window.currentLlmSessionId) {
          $("#btn-delete-session").prop("disabled", true);
        }
      } else {
        $sessionList.append(
          '<p class="text-muted small m-2">No saved sessions found.</p>',
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
        '<p class="text-danger small m-2">Error loading sessions.</p>',
      );
      $("#btn-delete-session").prop("disabled", true);
    });
}

$(document).ready(function () {
  console.log("MAIN_CTRL: Document ready. Initializing application...");

  if ($("#toast-container").length === 0) {
    $("body").append(
      '<div id="toast-container" class="toast-container position-fixed top-0 end-0 p-3" style="z-index: 1056"></div>',
    );
  }

  fetchAndUpdateInitialStatus();

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

  $("#btn-new-session").on("click", function () {
    console.log("MAIN_CTRL: New session button clicked.");
    apiCreateNewSession()
      .done(function (newSessionResponse) {
        console.log(
          "MAIN_CTRL: New session context created by API:",
          newSessionResponse,
        );
        window.currentLlmSessionId = newSessionResponse.id;
        $("#chat-messages")
          .empty()
          .append(
            '<div class="message-bubble agent-message">New session started.</div>',
          );
        if (newSessionResponse.rag_settings)
          window.currentRagSettings = newSessionResponse.rag_settings;
        if (newSessionResponse.llm_settings)
          window.currentLlmSettings = newSessionResponse.llm_settings;
        if (newSessionResponse.prompt_template_values)
          window.currentPromptTemplateValues =
            newSessionResponse.prompt_template_values;
        fetchAndDisplaySessions();
        if (typeof updateRagControlsState === "function")
          updateRagControlsState();
        if (typeof fetchAndPopulateLlmProviders === "function")
          fetchAndPopulateLlmProviders();
        if (typeof fetchAndDisplayPromptTemplateValues === "function")
          fetchAndDisplayPromptTemplateValues();
        updateContextUsageDisplay(null);
        window.stagedContextItems = [];
        if (typeof renderStagedContextItems === "function")
          renderStagedContextItems();
        if (
          typeof fetchAndDisplayWorkspaceItems === "function" &&
          $("#context-manager-tab-btn").hasClass("active")
        ) {
          fetchAndDisplayWorkspaceItems();
        }
        $("#btn-delete-session").prop("disabled", true);
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

  $("#session-list").on("click", ".list-group-item", function (e) {
    e.preventDefault();
    const sessionIdToLoad = $(this).data("session-id");
    console.log(`MAIN_CTRL: Loading session: ${sessionIdToLoad}`);
    apiLoadSession(sessionIdToLoad)
      .done(function (response) {
        console.log("MAIN_CTRL: Session loaded response:", response);
        const loadedSessionData = response.session_data;
        const appliedSettings = response.applied_settings;
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
            '<div class="message-bubble agent-message">Session loaded. No messages yet.</div>',
          );
        }
        if (appliedSettings) {
          window.currentRagSettings = {
            enabled: appliedSettings.rag_enabled || false,
            collectionName: appliedSettings.rag_collection_name || null,
            kValue: appliedSettings.rag_k_value || 3,
            filter: appliedSettings.rag_filter || null,
          };
          window.currentLlmSettings = {
            providerName: appliedSettings.current_provider_name || null,
            modelName: appliedSettings.current_model_name || null,
            systemMessage: appliedSettings.system_message || "",
          };
          window.currentPromptTemplateValues =
            appliedSettings.prompt_template_values || {};
        }
        fetchAndDisplaySessions();
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
        if (
          typeof fetchAndPopulateRagCollections === "function" &&
          $("#rag-collection-select").val() !==
            window.currentRagSettings.collectionName
        )
          fetchAndPopulateRagCollections();
        if (typeof fetchAndDisplayPromptTemplateValues === "function")
          fetchAndDisplayPromptTemplateValues();
        updateContextUsageDisplay(null);
        window.stagedContextItems = [];
        if (typeof renderStagedContextItems === "function")
          renderStagedContextItems();
        if (
          typeof fetchAndDisplayWorkspaceItems === "function" &&
          $("#context-manager-tab-btn").hasClass("active")
        )
          fetchAndDisplayWorkspaceItems();
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
          apiDeleteSession(window.currentLlmSessionId)
            .done(function (response) {
              console.log("MAIN_CTRL: Session delete response:", response);
              showToast(
                "Success",
                response.message || "Session deleted.",
                "success",
              );
              window.currentLlmSessionId = null;
              $("#chat-messages")
                .empty()
                .append(
                  '<div class="message-bubble agent-message">Session deleted. Start or load a new one.</div>',
                );
              fetchAndDisplaySessions();
              fetchAndUpdateInitialStatus();
              window.stagedContextItems = [];
              if (typeof renderStagedContextItems === "function")
                renderStagedContextItems();
              if (
                typeof fetchAndDisplayWorkspaceItems === "function" &&
                $("#context-manager-tab-btn").hasClass("active")
              )
                fetchAndDisplayWorkspaceItems();
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

  $("#settings-tab-btn").on("shown.bs.tab", function () {
    console.log(
      "MAIN_CTRL: Settings tab shown. UI modules handle their own specific updates if needed.",
    );
    if (typeof fetchAndPopulateLlmProviders === "function")
      fetchAndPopulateLlmProviders();
    if (typeof fetchAndDisplaySystemMessage === "function")
      fetchAndDisplaySystemMessage();
    if (typeof fetchAndDisplayPromptTemplateValues === "function")
      fetchAndDisplayPromptTemplateValues();
  });

  $("#chat-input").on("input", function () {
    if (typeof updateChatInputTokenEstimate === "function")
      updateChatInputTokenEstimate();
  });
  if (typeof updateChatInputTokenEstimate === "function")
    updateChatInputTokenEstimate();

  $("#repl-command-input").on("keypress", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      const commandText = $(this).val().trim();
      if (commandText) {
        console.log("MAIN_CTRL: REPL command to send:", commandText);
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
            console.log("MAIN_CTRL: REPL command response:", response);
            let outputHtml = `<div class="text-success">`;
            if (response.output)
              outputHtml += `<i class="fas fa-check-circle"></i> ${escapeHtml(response.output)}`;
            else if (response.command_received)
              outputHtml += `<i class="fas fa-check-circle"></i> Command '${escapeHtml(response.command_received)}' acknowledged. Status: ${escapeHtml(response.status || "unknown")}`;
            else
              outputHtml += `<i class="fas fa-info-circle"></i> Empty response from server.`;
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
