// llmchat_web/static/js/custom.js

/**
 * @file custom.js
 * @description Custom JavaScript and jQuery for the llmchat-web interface.
 * This file handles client-side logic, DOM manipulation, event handling,
 * AJAX calls to the Flask backend, session management,
 * data ingestion, and basic command tab interaction.
 * It also initializes other UI modules.
 *
 * Utility functions (escapeHtml, showToast) are in utils.js.
 * Session API call functions (apiFetchSessions, etc.) are in session_api.js.
 * Chat message UI and interaction logic are in chat_ui.js.
 * RAG UI logic is in rag_ui.js.
 * LLM Settings UI logic is in llm_settings_ui.js.
 * Context Manager UI logic is in context_manager_ui.js.
 * Prompt Template Values UI logic is in prompt_template_ui.js.
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
      // renderPromptTemplateValuesTable is now in prompt_template_ui.js,
      // it will be called by fetchAndDisplayPromptTemplateValues from that module.
      if (typeof fetchAndDisplayPromptTemplateValues === "function")
        fetchAndDisplayPromptTemplateValues();

      updateContextUsageDisplay(null);
      fetchAndDisplaySessions();

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

/**
 * Handles the submission of ingestion forms.
 * Uses fetch for SSE to stream progress.
 * @param {string} ingestType - The type of ingestion ('file', 'dir_zip', 'git').
 * @param {FormData} formData - The form data to submit.
 */
async function handleIngestionFormSubmit(ingestType, formData) {
  const $resultMsg = $("#ingestion-result-message");
  const $progressBar = $("#ingestion-progress-bar");
  const $progressContainer = $("#ingestion-progress-container");

  $resultMsg
    .removeClass("text-success text-danger")
    .addClass("text-muted")
    .text("Processing ingestion request...");
  $progressContainer.show();
  $progressBar
    .css("width", "0%")
    .removeClass("bg-success bg-danger")
    .attr("aria-valuenow", 0)
    .text("Starting...");

  try {
    const response = await fetch("/api/ingest", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      let errorText = `Server error: ${response.status} ${response.statusText}`;
      try {
        const errorData = await response.json();
        errorText = errorData.error || errorText;
      } catch (e) {
        /* Ignore */
      }
      throw new Error(errorText);
    }

    if (!response.body) {
      throw new Error("Response body is null, cannot read stream.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let filesProcessedInStream = 0;
    let totalFilesFromEvent = 0;

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        console.log("Ingestion stream finished by server.");
        if (
          $progressBar.text() !== "Complete!" &&
          $progressBar.text() !== "Failed!" &&
          $progressBar.text() !== "Completed with Errors!"
        ) {
          $progressBar
            .css("width", "100%")
            .addClass("bg-warning")
            .text("Stream ended, awaiting summary...");
        }
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      let eolIndex;
      while ((eolIndex = buffer.indexOf("\n\n")) >= 0) {
        const line = buffer.substring(0, eolIndex).trim();
        buffer = buffer.substring(eolIndex + 2);

        if (line.startsWith("data: ")) {
          try {
            const eventData = JSON.parse(line.substring(6));
            console.log("SSE Event:", eventData);

            if (eventData.type === "file_start") {
              totalFilesFromEvent =
                eventData.total_files || totalFilesFromEvent;
              $resultMsg.html(
                `Processing file <strong>${escapeHtml(eventData.filename)}</strong> (${eventData.file_index + 1} of ${totalFilesFromEvent})...`,
              );
              $progressBar.text(
                `File ${eventData.file_index + 1}/${totalFilesFromEvent}`,
              );
            } else if (eventData.type === "file_end") {
              filesProcessedInStream++;
              const progressPercent =
                totalFilesFromEvent > 0
                  ? (filesProcessedInStream / totalFilesFromEvent) * 100
                  : 50;
              $progressBar
                .css("width", `${progressPercent}%`)
                .attr("aria-valuenow", progressPercent);
              if (eventData.status === "success") {
                $resultMsg.append(
                  `<br><small class="text-success">- File <strong>${escapeHtml(eventData.filename)}</strong> processed successfully. Chunks added: ${eventData.chunks_added || 0}</small>`,
                );
              } else {
                $resultMsg.append(
                  `<br><small class="text-danger">- File <strong>${escapeHtml(eventData.filename)}</strong> failed: ${escapeHtml(eventData.error_message || "Unknown error")}</small>`,
                );
                $progressBar.addClass("bg-warning");
              }
            } else if (eventData.type === "ingestion_start") {
              $resultMsg.html(
                `Starting ingestion for <strong>${escapeHtml(eventData.ingest_type)}</strong> into collection <strong>${escapeHtml(eventData.collection_name)}</strong>...`,
              );
              $progressBar
                .css("width", `25%`)
                .attr("aria-valuenow", 25)
                .text("Processing...");
            } else if (eventData.type === "ingestion_complete") {
              const summary = eventData.summary;
              $progressBar.css("width", "100%").attr("aria-valuenow", 100);
              if (
                summary.status === "success" ||
                (summary.files_with_errors !== undefined &&
                  summary.files_with_errors === 0)
              ) {
                $progressBar.addClass("bg-success").text("Complete!");
                $resultMsg
                  .removeClass("text-muted text-danger")
                  .addClass("text-success")
                  .html(`<strong>Success!</strong> ${escapeHtml(summary.message) || "Ingestion completed."}<br>
                                             Total Files Submitted: ${summary.total_files_submitted || "N/A"}<br>
                                             Files Processed Successfully: ${summary.files_processed_successfully || "N/A"}<br>
                                             Files With Errors: ${summary.files_with_errors || 0}<br>
                                             Total Chunks Added: ${summary.total_chunks_added_to_db || 0}<br>
                                             Target Collection: ${escapeHtml(summary.collection_name)}`);
              } else {
                $progressBar
                  .addClass("bg-danger")
                  .text("Completed with Errors!");
                let errorDetailsHtml = "";
                if (
                  summary.error_messages &&
                  summary.error_messages.length > 0
                ) {
                  errorDetailsHtml = "<br>Details:<ul>";
                  summary.error_messages.forEach((err) => {
                    errorDetailsHtml += `<li><small>${escapeHtml(err)}</small></li>`;
                  });
                  errorDetailsHtml += "</ul>";
                }
                $resultMsg
                  .removeClass("text-muted text-success")
                  .addClass("text-danger")
                  .html(`<strong>Ingestion Completed with Errors!</strong> ${escapeHtml(summary.message) || ""}<br>
                                             Total Files Submitted: ${summary.total_files_submitted || "N/A"}<br>
                                             Files With Errors: ${summary.files_with_errors || "N/A"}<br>
                                             Total Chunks Added: ${summary.total_chunks_added_to_db || 0}
                                             ${errorDetailsHtml}`);
              }
              if (typeof fetchAndPopulateRagCollections === "function")
                fetchAndPopulateRagCollections();
              setTimeout(() => $progressContainer.fadeOut(), 3000);
            } else if (eventData.type === "error") {
              throw new Error(eventData.error);
            } else if (eventData.type === "end") {
              console.log(
                "SSE stream 'end' event received from server for ingestion.",
              );
              if (
                $progressBar.text() !== "Complete!" &&
                $progressBar.text() !== "Completed with Errors!" &&
                $progressBar.text() !== "Failed!"
              ) {
                $progressBar
                  .css("width", "100%")
                  .addClass("bg-warning")
                  .text("Finished.");
                $resultMsg.append(
                  "<br><small>Ingestion process ended.</small>",
                );
                setTimeout(() => $progressContainer.fadeOut(), 3000);
              }
            }
          } catch (e) {
            console.warn(
              "Error parsing SSE event data for ingestion:",
              e,
              "Line:",
              line,
            );
          }
        }
      }
    }
  } catch (error) {
    console.error(`Ingestion error (Type: ${ingestType}):`, error);
    $progressBar.css("width", "100%").addClass("bg-danger").text("Failed!");
    $resultMsg
      .removeClass("text-muted text-success")
      .addClass("text-danger")
      .html(
        `<strong>Error!</strong> Failed to ingest data: ${escapeHtml(error.message)}`,
      );
    setTimeout(() => $progressContainer.fadeOut(), 3000);
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
  fetchAndUpdateInitialStatus();
  if (typeof initChatEventListeners === "function") initChatEventListeners();
  if (typeof initRagEventListeners === "function") initRagEventListeners();
  if (typeof initLlmSettingsEventListeners === "function")
    initLlmSettingsEventListeners();
  if (typeof initContextManagerEventListeners === "function")
    initContextManagerEventListeners();
  if (typeof initPromptTemplateEventListeners === "function")
    initPromptTemplateEventListeners();

  // --- Session Management Event Handlers (using session_api.js) ---
  $("#btn-new-session").on("click", function () {
    console.log("New session button clicked.");
    apiCreateNewSession()
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

        fetchAndDisplaySessions();
        if (typeof updateRagControlsState === "function")
          updateRagControlsState();
        if (typeof fetchAndPopulateLlmProviders === "function")
          fetchAndPopulateLlmProviders();
        if (typeof fetchAndDisplaySystemMessage === "function")
          fetchAndDisplaySystemMessage();
        if (typeof fetchAndDisplayPromptTemplateValues === "function")
          fetchAndDisplayPromptTemplateValues(); // Call the new module's function

        updateContextUsageDisplay(null);

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
        console.error("Error creating new session:", textStatus, errorThrown);
        showToast("Error", "Failed to create new session.", "danger");
      });
  });

  $("#session-list").on("click", ".list-group-item", function (e) {
    e.preventDefault();
    const sessionIdToLoad = $(this).data("session-id");
    console.log(`Loading session: ${sessionIdToLoad}`);
    apiLoadSession(sessionIdToLoad)
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

        fetchAndDisplaySessions();
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
          fetchAndDisplayPromptTemplateValues(); // Call the new module's function

        updateContextUsageDisplay(null);

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
      "Confirm",
      `Delete session ${currentLlmSessionId}? This cannot be undone.`,
      "warning",
      true,
      function (confirmed) {
        if (confirmed) {
          console.log(`Deleting session: ${currentLlmSessionId}`);
          apiDeleteSession(currentLlmSessionId)
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
              fetchAndDisplaySessions();
              fetchAndUpdateInitialStatus();
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

  // --- Ingestion Event Handlers ---
  $("#btn-ingest-data").on("click", function () {
    var ingestionModal = new bootstrap.Modal(
      document.getElementById("ingestionModal"),
    );
    $("#form-ingest-file")[0].reset();
    $("#form-ingest-dir")[0].reset();
    $("#form-ingest-git")[0].reset();
    $("#ingestion-result-message")
      .empty()
      .addClass("text-muted")
      .text("Ingestion progress will appear here...");
    $("#ingestion-progress-bar").css("width", "0%").attr("aria-valuenow", 0);
    $("#ingestion-progress-container").hide();
    ingestionModal.show();
  });

  $("#form-ingest-file").on("submit", function (e) {
    e.preventDefault();
    const files = $("#ingest-file-input")[0].files;
    const collectionName = $("#ingest-file-collection").val().trim();
    if (!files.length || !collectionName) {
      showToast(
        "Error",
        "Please select file(s) and specify a target collection name.",
        "danger",
      );
      return;
    }
    const formData = new FormData();
    formData.append("ingest_type", "file");
    formData.append("collection_name", collectionName);
    for (let i = 0; i < files.length; i++) {
      formData.append("files[]", files[i]);
    }
    handleIngestionFormSubmit("file", formData);
  });

  $("#form-ingest-dir").on("submit", function (e) {
    e.preventDefault();
    const zipFile = $("#ingest-dir-zip-input")[0].files[0];
    const collectionName = $("#ingest-dir-collection").val().trim();
    const repoName = $("#ingest-dir-repo-name").val().trim() || null;
    if (!zipFile || !collectionName) {
      showToast(
        "Error",
        "Please select a ZIP file and specify a target collection name.",
        "danger",
      );
      return;
    }
    const formData = new FormData();
    formData.append("ingest_type", "dir_zip");
    formData.append("collection_name", collectionName);
    formData.append("zip_file", zipFile);
    if (repoName) formData.append("repo_name", repoName);
    handleIngestionFormSubmit("dir_zip", formData);
  });

  $("#form-ingest-git").on("submit", function (e) {
    e.preventDefault();
    const gitUrl = $("#ingest-git-url").val().trim();
    const collectionName = $("#ingest-git-collection").val().trim();
    const repoName = $("#ingest-git-repo-name").val().trim();
    const gitRef = $("#ingest-git-ref").val().trim() || null;
    if (!gitUrl || !collectionName || !repoName) {
      showToast(
        "Error",
        "Please provide Git URL, Target Collection, and Repository Identifier.",
        "danger",
      );
      return;
    }
    const formData = new FormData();
    formData.append("ingest_type", "git");
    formData.append("git_url", gitUrl);
    formData.append("collection_name", collectionName);
    formData.append("repo_name", repoName);
    if (gitRef) formData.append("git_ref", gitRef);
    handleIngestionFormSubmit("git", formData);
  });

  // --- Settings Tab Event Handler (for parts not covered by specific UI modules) ---
  $("#settings-tab-btn").on("shown.bs.tab", function () {
    console.log(
      "Settings tab shown by custom.js. Specific UI modules handle their own updates.",
    );
    // Note: fetchAndPopulateLlmProviders, fetchAndDisplaySystemMessage are called by initLlmSettingsEventListeners
    // fetchAndDisplayPromptTemplateValues is called by initPromptTemplateEventListeners
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

  console.log("LLMChat Web REPL UI initialized (client-side).");
});
