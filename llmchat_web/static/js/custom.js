// llmchat_web/static/js/custom.js

/**
 * @file custom.js
 * @description Custom JavaScript and jQuery for the llmchat-web interface.
 * This file handles client-side logic, DOM manipulation, event handling,
 * AJAX calls to the Flask backend, session management,
 * workspace item management, active context specification,
 * data ingestion, LLM settings,
 * prompt template values, and basic command tab interaction.
 *
 * Utility functions (escapeHtml, showToast) are in utils.js.
 * Session API call functions (apiFetchSessions, etc.) are in session_api.js.
 * Chat message UI and interaction logic (sendMessage, appendMessageToChat, initChatEventListeners) are in chat_ui.js.
 * RAG UI logic (controls, API calls, search) is in rag_ui.js.
 */

// Global variable to store the current LLMCore session ID for the web client
let currentLlmSessionId = null;
// Global array to store items staged for active context
let stagedContextItems = []; // Each item: {spec_item_id: 'actx_XYZ', type: 'text_content'|'file_content'|'workspace_item'|'message_history', id_ref?: 'actual_ws_or_msg_id', content?: 'text content', path?: 'file_path', no_truncate?: boolean }

// Global state for RAG settings (mirrors Flask session, updated via API)
// This object is accessed and potentially modified by rag_ui.js
let currentRagSettings = {
  enabled: false,
  collectionName: null,
  kValue: 3,
  filter: null, // Expects a dictionary or null
};

// Global state for LLM settings (mirrors Flask session, updated via API)
let currentLlmSettings = {
  providerName: null,
  modelName: null,
  systemMessage: "",
};

// Global state for Prompt Template Values (mirrors Flask session, updated via API)
let currentPromptTemplateValues = {}; // Object: { "key1": "value1", "key2": "value2" }

// escapeHtml and showToast functions are now in utils.js.
// Session API functions are in session_api.js.
// Chat UI functions are in chat_ui.js.
// RAG UI functions are in rag_ui.js.

/**
 * Fetches initial status from the backend and updates the UI and global state.
 * This function is called when the DOM is ready.
 */
function fetchAndUpdateInitialStatus() {
  console.log("Fetching initial status from /api/status...");
  $.ajax({
    url: "/api/status",
    type: "GET",
    dataType: "json",
    success: function (status) {
      console.log("Initial status received:", status);

      // Update App Version Display
      if (status.app_version) {
        $("#app-version-display").text(`v${status.app_version}`);
      }

      // Update LLMCore status in sidebar
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
        // error or other
        $("#llmcore-status-sidebar")
          .removeClass("bg-success bg-warning")
          .addClass("bg-danger")
          .text("Error");
        if (status.llmcore_error) {
          showToast("LLMCore Error", status.llmcore_error, "danger"); // from utils.js
        }
      }

      // Update current session ID
      currentLlmSessionId = status.current_session_id;
      console.log("Set currentLlmSessionId to:", currentLlmSessionId);

      // Update LLM Settings from /api/status
      currentLlmSettings.providerName = status.current_provider;
      currentLlmSettings.modelName = status.current_model;
      currentLlmSettings.systemMessage = status.system_message || "";

      $("#status-provider").text(currentLlmSettings.providerName || "N/A");
      $("#status-model").text(currentLlmSettings.modelName || "N/A");
      // Populate dropdowns and set selected values if settings tab is active or for initial load
      fetchAndPopulateLlmProviders(); // This will also try to set selected and fetch models
      fetchAndDisplaySystemMessage(); // This will update the input field

      // Update RAG Settings from /api/status
      currentRagSettings.enabled = status.rag_enabled || false;
      currentRagSettings.collectionName = status.rag_collection_name;
      currentRagSettings.kValue = status.rag_k_value || 3;
      currentRagSettings.filter = status.rag_filter || null; // Expects dict or null
      // Functions from rag_ui.js will be responsible for updating UI based on currentRagSettings
      if (typeof updateRagControlsState === "function")
        updateRagControlsState();
      if (typeof fetchAndPopulateRagCollections === "function")
        fetchAndPopulateRagCollections();

      // Update Prompt Template Values from /api/status
      currentPromptTemplateValues = status.prompt_template_values || {};
      renderPromptTemplateValuesTable();

      // Update context usage display. /api/status doesn't provide this directly.
      // It's typically updated after a chat response. Initialize to N/A.
      updateContextUsageDisplay(null);

      // Refresh dynamic UI parts that depend on session state
      fetchAndDisplaySessions(); // Refresh session list (and highlight active)

      if (currentLlmSessionId) {
        // If the context manager tab is already active, fetch its content.
        if ($("#context-manager-tab-btn").hasClass("active")) {
          fetchAndDisplayWorkspaceItems();
        }
        // Render staged items (likely empty on initial load unless persisted elsewhere)
        renderStagedContextItems();
      } else {
        $("#workspace-items-list").html(
          '<p class="text-muted p-2">No active session. Create or load one.</p>',
        );
        $("#active-context-spec-list").html(
          '<p class="text-muted p-2">No active session for context items.</p>',
        );
      }

      // Update Coworker status (placeholder, as it's not in /api/status yet)
      // Assuming coworker status is off by default or needs its own state management.
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

/**
 * Fetches and displays workspace items for the current session.
 */
function fetchAndDisplayWorkspaceItems() {
  if (!currentLlmSessionId) {
    $("#workspace-items-list").html(
      '<p class="text-muted p-2">No active session to load workspace items from.</p>',
    );
    return;
  }
  console.log(`Fetching workspace items for session: ${currentLlmSessionId}`);
  $.ajax({
    url: `/api/sessions/${currentLlmSessionId}/workspace/items`,
    type: "GET",
    dataType: "json",
    success: function (items) {
      console.log("Workspace items received:", items);
      const $itemList = $("#workspace-items-list").empty();
      if (items && items.length > 0) {
        items.forEach(function (item) {
          const itemTypeDisplay = item.type || "UNKNOWN";
          const sourceIdDisplay = item.source_id || item.id;
          const contentPreview = item.content
            ? item.content.substring(0, 100) +
              (item.content.length > 100 ? "..." : "")
            : "No content preview.";

          const $itemDiv = $("<div>", {
            class: "workspace-item",
            "data-item-id": item.id,
            "data-item-type": item.type,
            "data-item-content-preview": item.content, // Store full content for modal
          });
          $itemDiv.append(
            `<div class="workspace-item-header">ID: ${escapeHtml(item.id)} (Type: ${escapeHtml(itemTypeDisplay)})</div>`,
          );
          $itemDiv.append(
            `<div class="small text-muted">Source: ${escapeHtml(sourceIdDisplay)}</div>`,
          );
          $itemDiv.append(
            `<div class="workspace-item-content-preview">${escapeHtml(contentPreview.replace(/\n/g, " "))}</div>`,
          );

          const $actions = $("<div>", { class: "workspace-item-actions mt-1" });
          $actions.append(
            $("<button>", {
              class: "btn btn-sm btn-outline-info me-1 btn-view-workspace-item",
              title: "View Content",
            }).html('<i class="fas fa-eye fa-xs"></i> Show'),
          );
          $actions.append(
            $("<button>", {
              class:
                "btn btn-sm btn-outline-primary me-1 btn-stage-this-workspace-item",
              title: "Stage for Active Context",
            }).html('<i class="fas fa-arrow-right fa-xs"></i> Stage'),
          );
          $actions.append(
            $("<button>", {
              class: "btn btn-sm btn-outline-danger btn-remove-workspace-item",
              title: "Remove Item",
            }).html('<i class="fas fa-trash-alt fa-xs"></i> Remove'),
          );
          $itemDiv.append($actions);
          $itemList.append($itemDiv);
        });
      } else {
        $itemList.append(
          '<p class="text-muted p-2">No workspace items found for this session.</p>',
        );
      }
    },
    error: function (jqXHR, textStatus, errorThrown) {
      console.error("Error fetching workspace items:", textStatus, errorThrown);
      $("#workspace-items-list").html(
        '<p class="text-danger small p-2">Error loading workspace items.</p>',
      );
    },
  });
}

/**
 * Renders the staged context items in the UI.
 */
function renderStagedContextItems() {
  const $list = $("#active-context-spec-list").empty();
  if (stagedContextItems.length === 0) {
    $list.append(
      '<p class="text-muted p-2">No items staged for active context.</p>',
    );
    return;
  }
  stagedContextItems.forEach(function (item, index) {
    const $itemDiv = $("<div>", {
      class: "staged-context-item",
      "data-staged-item-spec-id": item.spec_item_id,
    });
    let itemTypeDisplay = item.type.replace(/_/g, " ");
    itemTypeDisplay =
      itemTypeDisplay.charAt(0).toUpperCase() + itemTypeDisplay.slice(1);

    $itemDiv.append(
      `<div class="staged-item-header">ID: ${escapeHtml(item.spec_item_id)} (Type: ${escapeHtml(itemTypeDisplay)})</div>`,
    );

    let sourceDisplay = "N/A";
    if (item.type === "workspace_item" || item.type === "message_history") {
      sourceDisplay = item.id_ref || "Unknown Ref";
    } else if (item.type === "file_content" && item.path) {
      sourceDisplay = item.path.split(/[\\/]/).pop();
    } else if (item.type === "text_content") {
      sourceDisplay = "Direct Text";
    }
    $itemDiv.append(
      `<div class="small text-muted">Source: ${escapeHtml(sourceDisplay)}</div>`,
    );

    const contentPreview = item.content
      ? item.content.substring(0, 70) + (item.content.length > 70 ? "..." : "")
      : item.path
        ? item.path
        : "No preview";
    $itemDiv.append(
      `<div class="staged-item-content-preview">${escapeHtml(contentPreview.replace(/\n/g, " "))}</div>`,
    );

    const $actions = $("<div>", { class: "staged-item-actions mt-1" });
    if (item.type === "text_content") {
      $actions.append(
        $("<button>", {
          class: "btn btn-sm btn-outline-warning me-1 btn-edit-staged-item",
          title: "Edit Staged Item",
          "data-staged-item-spec-id": item.spec_item_id,
        }).html('<i class="fas fa-edit fa-xs"></i> Edit'),
      );
    }
    $actions.append(
      $("<button>", {
        class: "btn btn-sm btn-outline-danger btn-remove-staged-item",
        title: "Remove from Staged",
        "data-staged-item-spec-id": item.spec_item_id,
      }).html('<i class="fas fa-times-circle fa-xs"></i> Remove'),
    );
    $itemDiv.append($actions);
    $list.append($itemDiv);
  });
}

/**
 * Adds an item to the stagedContextItems array and re-renders the list.
 * @param {string} type - Type of the item.
 * @param {string|null} id_ref - Original ID if referencing existing item.
 * @param {string|null} content - Content of the item.
 * @param {string|null} path - Path if it's a file.
 * @param {boolean} no_truncate - Whether to disable truncation.
 */
function addStagedContextItem(
  type,
  id_ref,
  content,
  path,
  no_truncate = false,
) {
  const spec_item_id = `actx_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  stagedContextItems.push({
    spec_item_id: spec_item_id,
    type: type,
    id_ref: id_ref,
    content: content,
    path: path,
    no_truncate: no_truncate,
  });
  renderStagedContextItems();
  console.log(
    "Added to staged items:",
    stagedContextItems[stagedContextItems.length - 1],
  );
}

/**
 * Removes an item from the stagedContextItems array by its spec_item_id and re-renders.
 * @param {string} spec_item_id_to_remove - The unique ID of the staged item to remove.
 */
function removeStagedContextItem(spec_item_id_to_remove) {
  stagedContextItems = stagedContextItems.filter(
    (item) => item.spec_item_id !== spec_item_id_to_remove,
  );
  renderStagedContextItems();
  console.log(
    `Removed staged item ${spec_item_id_to_remove}. Remaining:`,
    stagedContextItems,
  );
}

/**
 * Fetches available LLM providers and populates the provider dropdown.
 */
function fetchAndPopulateLlmProviders() {
  console.log("Fetching LLM providers...");
  $.ajax({
    url: "/api/llm/providers",
    type: "GET",
    dataType: "json",
    success: function (providers) {
      console.log("LLM Providers received:", providers);
      const $select = $("#llm-provider-select");
      $select
        .empty()
        .append('<option selected value="">Select Provider...</option>');
      if (providers && providers.length > 0) {
        providers.forEach(function (provider) {
          const providerName =
            typeof provider === "string"
              ? provider
              : provider.name || provider.id;
          const providerValue =
            typeof provider === "string"
              ? provider
              : provider.id || provider.name;
          $select.append(
            $("<option>", {
              value: providerValue,
              text: escapeHtml(providerName),
            }),
          );
        });
        if (currentLlmSettings.providerName) {
          $select.val(currentLlmSettings.providerName);
          fetchAndPopulateLlmModels(currentLlmSettings.providerName);
        }
      } else {
        $select.append('<option value="" disabled>No providers found</option>');
      }
      $select.prop("disabled", false);
    },
    error: function (jqXHR, textStatus, errorThrown) {
      console.error("Error fetching LLM providers:", textStatus, errorThrown);
      $("#llm-provider-select")
        .empty()
        .append('<option value="" disabled>Error loading providers</option>');
      $("#llm-model-select")
        .empty()
        .append('<option value="">Select provider first</option>')
        .prop("disabled", true);
    },
  });
}

/**
 * Fetches available models for the selected LLM provider and populates the model dropdown.
 * @param {string} providerName - The name of the selected LLM provider.
 */
function fetchAndPopulateLlmModels(providerName) {
  console.log(`Fetching models for provider: ${providerName}...`);
  const $modelSelect = $("#llm-model-select");
  $modelSelect
    .empty()
    .append('<option selected value="">Loading models...</option>')
    .prop("disabled", true);

  if (!providerName) {
    $modelSelect
      .empty()
      .append('<option selected value="">Select provider first</option>')
      .prop("disabled", true);
    return;
  }

  $.ajax({
    url: `/api/llm/providers/${providerName}/models`,
    type: "GET",
    dataType: "json",
    success: function (models) {
      console.log(`Models for ${providerName}:`, models);
      $modelSelect
        .empty()
        .append('<option selected value="">Select Model...</option>');
      if (models && models.length > 0) {
        models.forEach(function (model) {
          const modelName =
            typeof model === "string" ? model : model.name || model.id;
          const modelValue =
            typeof model === "string" ? model : model.id || model.name;
          $modelSelect.append(
            $("<option>", { value: modelValue, text: escapeHtml(modelName) }),
          );
        });
        if (
          currentLlmSettings.providerName === providerName &&
          currentLlmSettings.modelName
        ) {
          $modelSelect.val(currentLlmSettings.modelName);
        }
      } else {
        $modelSelect.append(
          '<option value="" disabled>No models found for this provider (or type any)</option>',
        );
      }
      $modelSelect.prop("disabled", false);
    },
    error: function (jqXHR, textStatus, errorThrown) {
      console.error(
        `Error fetching models for ${providerName}:`,
        textStatus,
        errorThrown,
      );
      $modelSelect
        .empty()
        .append('<option value="" disabled>Error loading models</option>')
        .prop("disabled", false);
    },
  });
}

/**
 * Sends selected LLM provider and model to the backend.
 */
function applyLlmSettings() {
  const providerName = $("#llm-provider-select").val();
  const modelName = $("#llm-model-select").val();

  if (!providerName) {
    showToast("Warning", "Please select an LLM provider.", "warning");
    return;
  }
  console.log(
    `Applying LLM settings: Provider=${providerName}, Model=${modelName}`,
  );

  $.ajax({
    url: "/api/settings/llm/update",
    type: "POST",
    contentType: "application/json",
    data: JSON.stringify({
      provider_name: providerName,
      model_name: modelName || null,
    }),
    dataType: "json",
    success: function (response) {
      console.log("LLM settings updated successfully on backend:", response);
      if (response && response.llm_settings) {
        currentLlmSettings.providerName = response.llm_settings.provider_name;
        currentLlmSettings.modelName = response.llm_settings.model_name;
        $("#status-provider").text(currentLlmSettings.providerName || "N/A");
        $("#status-model").text(currentLlmSettings.modelName || "N/A");
        showToast("Success", "LLM settings applied successfully!", "success");
      }
      // No need to call fetchAndUpdateInitialStatus here, as this only updates a subset.
      // The global currentLlmSettings are updated, and UI elements directly related are refreshed.
    },
    error: function (jqXHR, textStatus, errorThrown) {
      console.error(
        "Error updating LLM settings on backend:",
        textStatus,
        errorThrown,
      );
      showToast("Error", "Failed to apply LLM settings.", "danger");
    },
  });
}

/**
 * Fetches and displays the current system message for the session.
 */
function fetchAndDisplaySystemMessage() {
  console.log("Fetching current system message...");
  // Use the globally synced currentLlmSettings.systemMessage
  if (
    currentLlmSettings.systemMessage !== null &&
    currentLlmSettings.systemMessage !== undefined
  ) {
    $("#system-message-input").val(currentLlmSettings.systemMessage);
  } else {
    // Fallback if global state is somehow not set (should be by fetchAndUpdateInitialStatus)
    $.ajax({
      url: "/api/settings/system_message",
      type: "GET",
      dataType: "json",
      success: function (response) {
        console.log("System message received (fallback):", response);
        if (response && response.system_message !== undefined) {
          currentLlmSettings.systemMessage = response.system_message;
          $("#system-message-input").val(response.system_message);
        }
      },
      error: function (jqXHR, textStatus, errorThrown) {
        console.error(
          "Error fetching system message (fallback):",
          textStatus,
          errorThrown,
        );
      },
    });
  }
}

/**
 * Sends the updated system message to the backend.
 */
function applySystemMessage() {
  const systemMessage = $("#system-message-input").val();
  console.log("Applying system message:", systemMessage);

  $.ajax({
    url: "/api/settings/system_message/update",
    type: "POST",
    contentType: "application/json",
    data: JSON.stringify({ system_message: systemMessage }),
    dataType: "json",
    success: function (response) {
      console.log("System message updated successfully:", response);
      if (response && response.system_message !== undefined) {
        currentLlmSettings.systemMessage = response.system_message; // Update global state
        showToast("Success", "System message applied successfully!", "success");
      }
    },
    error: function (jqXHR, textStatus, errorThrown) {
      console.error("Error updating system message:", textStatus, errorThrown);
      showToast("Error", "Failed to apply system message.", "danger");
    },
  });
}

/**
 * Renders the prompt template values in the settings table.
 */
function renderPromptTemplateValuesTable() {
  const $tbody = $("#prompt-values-tbody");
  $tbody.empty(); // Clear existing rows

  if (Object.keys(currentPromptTemplateValues).length === 0) {
    $tbody.append(
      '<tr><td colspan="3" class="text-center text-muted">No prompt values set.</td></tr>',
    );
    return;
  }

  for (const key in currentPromptTemplateValues) {
    if (currentPromptTemplateValues.hasOwnProperty(key)) {
      const value = currentPromptTemplateValues[key];
      const $row = $("<tr>").append(
        $("<td>").text(key),
        $("<td>").text(value),
        $("<td>").append(
          // Placeholder for Edit button, for now only Delete
          // $('<button class="btn btn-warning btn-sm me-1 btn-edit-prompt-value" title="Edit Value"><i class="fas fa-edit fa-xs"></i></button>').attr('data-key', key),
          $(
            '<button class="btn btn-danger btn-sm btn-delete-prompt-value" title="Delete Value"><i class="fas fa-trash-alt fa-xs"></i></button>',
          ).attr("data-key", key),
        ),
      );
      $tbody.append($row);
    }
  }
}

/**
 * Fetches current prompt template values from the backend and updates the UI.
 */
function fetchAndDisplayPromptTemplateValues() {
  console.log("Fetching prompt template values...");
  // Use the globally synced currentPromptTemplateValues if available
  // Check if it's an object and not empty
  if (
    currentPromptTemplateValues &&
    typeof currentPromptTemplateValues === "object" && // Ensure it's an object
    Object.keys(currentPromptTemplateValues).length > 0
  ) {
    renderPromptTemplateValuesTable();
  } else {
    // Fallback to fetch if global state is empty or not an object
    // (should be populated as {} by fetchAndUpdateInitialStatus if not set by API)
    $.ajax({
      url: "/api/settings/prompt_template_values",
      type: "GET",
      dataType: "json",
      success: function (response) {
        console.log("Prompt template values received (fallback):", response);
        if (response && typeof response.prompt_template_values === "object") {
          currentPromptTemplateValues = response.prompt_template_values;
        } else {
          currentPromptTemplateValues = {}; // Default to empty object
        }
        renderPromptTemplateValuesTable();
      },
      error: function (jqXHR, textStatus, errorThrown) {
        console.error(
          "Error fetching prompt template values (fallback):",
          textStatus,
          errorThrown,
        );
        currentPromptTemplateValues = {}; // Reset on error
        renderPromptTemplateValuesTable(); // Render empty or error state
        showToast("Error", "Failed to load prompt template values.", "danger");
      },
    });
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

  // All ingestion types use SSE
  try {
    const response = await fetch("/api/ingest", {
      method: "POST",
      body: formData,
      // No 'Content-Type' header for FormData, browser sets it with boundary
    });

    if (!response.ok) {
      let errorText = `Server error: ${response.status} ${response.statusText}`;
      try {
        const errorData = await response.json();
        errorText = errorData.error || errorText;
      } catch (e) {
        /* Ignore if response is not JSON */
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

  fetchAndUpdateInitialStatus();
  if (typeof initChatEventListeners === "function") initChatEventListeners();
  if (typeof initRagEventListeners === "function") initRagEventListeners();

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
        fetchAndPopulateLlmProviders();
        fetchAndDisplaySystemMessage();
        renderPromptTemplateValuesTable();
        updateContextUsageDisplay(null);

        stagedContextItems = [];
        renderStagedContextItems();
        if ($("#context-manager-tab-btn").hasClass("active")) {
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
            // Assuming appendMessageToChat is globally available from chat_ui.js
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
        $("#system-message-input").val(currentLlmSettings.systemMessage);
        if (
          $("#llm-provider-select").val() !== currentLlmSettings.providerName
        ) {
          $("#llm-provider-select").val(currentLlmSettings.providerName);
          fetchAndPopulateLlmModels(currentLlmSettings.providerName);
        } else if (
          $("#llm-model-select").val() !== currentLlmSettings.modelName
        ) {
          $("#llm-model-select").val(currentLlmSettings.modelName);
        }

        if (typeof updateRagControlsState === "function")
          updateRagControlsState();
        if (
          $("#rag-collection-select").val() !==
            currentRagSettings.collectionName &&
          typeof fetchAndPopulateRagCollections === "function"
        ) {
          fetchAndPopulateRagCollections();
        }

        renderPromptTemplateValuesTable();
        updateContextUsageDisplay(null);

        stagedContextItems = [];
        renderStagedContextItems();
        if ($("#context-manager-tab-btn").hasClass("active")) {
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
              renderStagedContextItems();
              if ($("#context-manager-tab-btn").hasClass("active")) {
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

  // --- Context Manager Event Handlers ---
  $("#context-manager-tab-btn").on("shown.bs.tab", function (e) {
    fetchAndDisplayWorkspaceItems();
    renderStagedContextItems();
  });
  $("#form-add-text-snippet").on("submit", function (e) {
    e.preventDefault();
    const content = $("#text-snippet-content").val().trim();
    const customId = $("#text-snippet-id").val().trim() || null;
    if (!content || !currentLlmSessionId) {
      showToast("Error", "Content and active session are required.", "danger");
      return;
    }
    $.ajax({
      url: `/api/sessions/${currentLlmSessionId}/workspace/add_text`,
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify({ content: content, item_id: customId }),
      dataType: "json",
      success: function (response) {
        console.log("Add text snippet response:", response);
        showToast(
          "Success",
          `Text snippet added as item: ${escapeHtml(response.id)}`,
          "success",
        );
        $("#form-add-text-snippet")[0].reset();
        fetchAndDisplayWorkspaceItems();
      },
      error: function (jqXHR, textStatus, errorThrown) {
        console.error("Error adding text snippet:", textStatus, errorThrown);
        showToast("Error", "Failed to add text snippet.", "danger");
      },
    });
  });
  $("#form-add-file-by-path").on("submit", function (e) {
    e.preventDefault();
    const filePath = $("#file-path-input").val().trim();
    const customId = $("#file-item-id").val().trim() || null;
    if (!filePath || !currentLlmSessionId) {
      showToast(
        "Error",
        "File path and active session are required.",
        "danger",
      );
      return;
    }
    $.ajax({
      url: `/api/sessions/${currentLlmSessionId}/workspace/add_file`,
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify({ file_path: filePath, item_id: customId }),
      dataType: "json",
      success: function (response) {
        console.log("Add file by path response:", response);
        showToast(
          "Success",
          `File added as item: ${escapeHtml(response.id)}`,
          "success",
        );
        $("#form-add-file-by-path")[0].reset();
        fetchAndDisplayWorkspaceItems();
      },
      error: function (jqXHR, textStatus, errorThrown) {
        console.error("Error adding file by path:", textStatus, errorThrown);
        const errorMsg = jqXHR.responseJSON
          ? jqXHR.responseJSON.error
          : "Failed to add file by path.";
        showToast("Error", errorMsg, "danger");
      },
    });
  });
  $("#workspace-items-list").on(
    "click",
    ".btn-view-workspace-item",
    function () {
      const itemId = $(this).closest(".workspace-item").data("item-id");
      if (!itemId || !currentLlmSessionId) return;
      $.ajax({
        url: `/api/sessions/${currentLlmSessionId}/workspace/items/${itemId}`,
        type: "GET",
        dataType: "json",
        success: function (item) {
          $("#modalItemContentDisplay").text(
            item.content || "No content available.",
          );
          $("#viewItemContentModalLabel").text(
            `Content of Item: ${escapeHtml(item.id)} (Type: ${escapeHtml(item.type)})`,
          );
          var myModal = new bootstrap.Modal(
            document.getElementById("viewItemContentModal"),
          );
          myModal.show();
        },
        error: function () {
          showToast("Error", "Error fetching item content.", "danger");
        },
      });
    },
  );
  $("#workspace-items-list").on(
    "click",
    ".btn-remove-workspace-item",
    function () {
      const itemId = $(this).closest(".workspace-item").data("item-id");
      if (!itemId || !currentLlmSessionId) return;
      showToast(
        "Confirm",
        `Remove workspace item ${itemId}?`,
        "warning",
        true,
        function (confirmed) {
          if (confirmed) {
            $.ajax({
              url: `/api/sessions/${currentLlmSessionId}/workspace/items/${itemId}`,
              type: "DELETE",
              dataType: "json",
              success: function (response) {
                showToast(
                  "Success",
                  response.message || "Item removed.",
                  "success",
                );
                fetchAndDisplayWorkspaceItems();
                stagedContextItems = stagedContextItems.filter(
                  (si) =>
                    !(si.type === "workspace_item" && si.id_ref === itemId),
                );
                renderStagedContextItems();
              },
              error: function () {
                showToast("Error", "Error removing item.", "danger");
              },
            });
          }
        },
      );
    },
  );
  $("#workspace-items-list").on(
    "click",
    ".btn-stage-this-workspace-item",
    function () {
      const $itemDiv = $(this).closest(".workspace-item");
      const itemId = $itemDiv.data("item-id");
      const contentPreview =
        $itemDiv.data("item-content-preview") ||
        "Content not available for preview.";
      addStagedContextItem("workspace_item", itemId, contentPreview, null);
      showToast(
        "Staged",
        `Workspace item ${itemId} added to active context.`,
        "info",
      );
    },
  );
  $("#btn-stage-from-workspace").on("click", function () {
    showToast(
      "Info",
      "Modal to select from workspace items - Not Implemented Yet.",
      "info",
    );
  });
  $("#btn-stage-from-history").on("click", function () {
    showToast(
      "Info",
      "Modal to select from chat history - Not Implemented Yet.",
      "info",
    );
  });
  $("#btn-stage-new-file").on("click", function () {
    const filePath = prompt("Enter server path to file to stage:");
    if (filePath && filePath.trim() !== "") {
      addStagedContextItem("file_content", null, null, filePath.trim()); // Content will be fetched by backend if needed
      showToast("Staged", `File ${filePath} added to active context.`, "info");
    }
  });
  $("#btn-stage-new-text").on("click", function () {
    const textContent = prompt("Enter text content to stage:");
    if (textContent && textContent.trim() !== "") {
      addStagedContextItem("text_content", null, textContent.trim(), null);
      showToast("Staged", `Text snippet added to active context.`, "info");
    }
  });
  $("#active-context-spec-list").on(
    "click",
    ".btn-remove-staged-item",
    function () {
      const specItemId = $(this).data("staged-item-spec-id");
      removeStagedContextItem(specItemId);
      showToast(
        "Removed",
        `Item ${specItemId} removed from active context.`,
        "info",
      );
    },
  );
  $("#active-context-spec-list").on(
    "click",
    ".btn-edit-staged-item",
    function () {
      const specItemId = $(this).data("staged-item-spec-id");
      const item = stagedContextItems.find(
        (i) => i.spec_item_id === specItemId,
      );
      if (item && item.type === "text_content") {
        const newContent = prompt("Edit staged text content:", item.content);
        if (newContent !== null) {
          item.content = newContent;
          renderStagedContextItems();
          showToast("Updated", `Staged item ${specItemId} updated.`, "info");
        }
      } else {
        showToast(
          "Warning",
          "Can only edit staged text items directly.",
          "warning",
        );
      }
    },
  );
  $("#btn-preview-full-context").on("click", function () {
    if (!currentLlmSessionId) {
      showToast("Error", "No active session to preview context for.", "danger");
      return;
    }
    const userQueryForPreview =
      $("#context-preview-query-input").val().trim() || null;
    $("#modalContextPreviewDisplay").html(
      '<p class="text-muted">Generating context preview...</p>',
    );
    var previewModal = new bootstrap.Modal(
      document.getElementById("contextPreviewModal"),
    );
    previewModal.show();

    $.ajax({
      url: `/api/sessions/${currentLlmSessionId}/context/preview`,
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify({
        current_query: userQueryForPreview,
        staged_items: stagedContextItems, // Send client-side staged items
      }),
      dataType: "json",
      success: function (data) {
        renderContextPreviewModal(data);
      },
      error: function (jqXHR, textStatus, errorThrown) {
        console.error(
          "Error fetching context preview:",
          textStatus,
          errorThrown,
        );
        $("#modalContextPreviewDisplay").html(
          `<p class="text-danger">Error generating preview: ${escapeHtml(jqXHR.responseJSON ? jqXHR.responseJSON.error : errorThrown)}</p>`,
        );
      },
    });
  });
  function renderContextPreviewModal(data) {
    const $display = $("#modalContextPreviewDisplay").empty();
    if (!data) {
      $display.html('<p class="text-danger">No preview data received.</p>');
      return;
    }

    $display.append(
      `<h5><i class="fas fa-file-alt"></i> Effective Context for LLM</h5>`,
    );
    $display.append(
      `<p class="mb-1"><small class="text-muted">LLM Provider: ${escapeHtml(data.provider_name) || "N/A"}, Model: ${escapeHtml(data.model_name) || "N/A"}</small></p>`,
    );
    $display.append(
      `<p class="mb-1"><small class="text-muted">Max Tokens: ${data.max_tokens_for_model || "N/A"}, Final Token Count: <strong>${data.final_token_count || "N/A"}</strong></small></p>`,
    );

    if (
      data.truncation_actions_taken &&
      data.truncation_actions_taken.details &&
      data.truncation_actions_taken.details.length > 0
    ) {
      $display.append(
        `<h6><i class="fas fa-cut"></i> Truncation Actions:</h6>`,
      );
      const $truncList = $('<ul class="list-unstyled small"></ul>');
      data.truncation_actions_taken.details.forEach((action) =>
        $truncList.append($("<li>").text(action)),
      );
      $display.append($truncList);
    }

    $display.append(
      `<h6><i class="fas fa-envelope-open-text"></i> Prepared Messages:</h6>`,
    );
    if (data.prepared_messages && data.prepared_messages.length > 0) {
      const $msgList = $(
        '<div class="list-group list-group-flush mb-3"></div>',
      );
      data.prepared_messages.forEach((msg) => {
        const $msgItem =
          $(`<div class="list-group-item bg-transparent px-0 py-1 border-bottom-0">
                                  <strong class="text-info">${escapeHtml(msg.role.toUpperCase())}:</strong>
                                  <pre style="white-space: pre-wrap; word-break: break-all; font-size: 0.9em;">${escapeHtml(msg.content)}</pre>
                                  <small class="text-muted d-block text-end">Tokens: ${msg.tokens || "N/A"}</small>
                               </div>`);
        $msgList.append($msgItem);
      });
      $display.append($msgList);
    } else {
      $display.append(
        '<p class="text-muted small">No messages prepared (check query and context items).</p>',
      );
    }

    if (data.rag_documents_used && data.rag_documents_used.length > 0) {
      $display.append(
        `<h6><i class="fas fa-book-reader"></i> RAG Documents Used:</h6>`,
      );
      const $ragList = $('<ul class="list-unstyled small"></ul>');
      data.rag_documents_used.forEach((doc) => {
        const score = doc.score ? ` (Score: ${doc.score.toFixed(3)})` : "";
        $ragList.append(
          $("<li>").html(
            `<strong>ID:</strong> ${escapeHtml(doc.id)}${score} <br> <pre style="font-size:0.85em; max-height:100px; overflow-y:auto;">${escapeHtml(doc.content)}</pre>`,
          ),
        );
      });
      $display.append($ragList);
    }

    if (data.rendered_rag_template_content) {
      $display.append(
        `<h6><i class="fas fa-code"></i> Rendered RAG Prompt (if RAG active):</h6>`,
      );
      $display.append(
        `<pre style="white-space: pre-wrap; word-break: break-all; font-size: 0.8em; max-height: 200px; overflow-y: auto; background-color: #333; padding: 5px; border-radius: 3px;">${escapeHtml(data.rendered_rag_template_content)}</pre>`,
      );
    }
  }

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

  // --- Settings Tab Event Handlers ---
  $("#settings-tab-btn").on("shown.bs.tab", function () {
    console.log(
      "Settings tab shown. Initializing LLM controls and prompt values.",
    );
    fetchAndPopulateLlmProviders(); // Also populates models if provider is set
    fetchAndDisplaySystemMessage();
    fetchAndDisplayPromptTemplateValues(); // Fetch and display prompt values
  });

  $("#llm-provider-select").on("change", function () {
    const selectedProvider = $(this).val();
    if (selectedProvider) {
      fetchAndPopulateLlmModels(selectedProvider);
    } else {
      $("#llm-model-select")
        .empty()
        .append('<option value="">Select provider first</option>')
        .prop("disabled", true);
    }
  });

  $("#btn-apply-llm-settings").on("click", function () {
    applyLlmSettings();
  });

  $("#btn-apply-system-message").on("click", function () {
    applySystemMessage();
  });

  // --- Prompt Template Values Event Handlers ---
  $("#form-add-prompt-value").on("submit", function (e) {
    e.preventDefault();
    const key = $("#new-prompt-key").val().trim();
    const value = $("#new-prompt-value").val().trim();
    if (!key || !value) {
      showToast(
        "Error",
        "Both key and value are required for prompt template values.",
        "danger",
      );
      return;
    }
    console.log(`Adding prompt template value: ${key} = ${value}`);
    $.ajax({
      url: "/api/settings/prompt_template_values/update", // Endpoint to add/update a single key-value
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify({ key: key, value: value }),
      dataType: "json",
      success: function (response) {
        if (response && response.prompt_template_values) {
          currentPromptTemplateValues = response.prompt_template_values;
          renderPromptTemplateValuesTable();
          $("#form-add-prompt-value")[0].reset();
          showToast(
            "Success",
            `Prompt value for '${escapeHtml(key)}' saved.`,
            "success",
          );
        } else {
          showToast(
            "Error",
            response.error || "Failed to save prompt value.",
            "danger",
          );
        }
      },
      error: function (jqXHR) {
        const errorMsg = jqXHR.responseJSON
          ? jqXHR.responseJSON.error
          : "Server error saving prompt value.";
        showToast("Error", errorMsg, "danger");
      },
    });
  });

  $("#prompt-values-tbody").on(
    "click",
    ".btn-delete-prompt-value",
    function () {
      const keyToDelete = $(this).data("key");
      showToast(
        "Confirm",
        `Delete prompt value for key "${escapeHtml(keyToDelete)}"?`,
        "warning",
        true,
        function (confirmed) {
          if (confirmed) {
            console.log(
              `Deleting prompt template value for key: ${keyToDelete}`,
            );
            $.ajax({
              url: "/api/settings/prompt_template_values/delete_key", // Endpoint to delete a specific key
              type: "POST",
              contentType: "application/json",
              data: JSON.stringify({ key: keyToDelete }),
              dataType: "json",
              success: function (response) {
                if (response && response.prompt_template_values) {
                  currentPromptTemplateValues = response.prompt_template_values;
                  renderPromptTemplateValuesTable();
                  showToast(
                    "Success",
                    `Prompt value for '${escapeHtml(keyToDelete)}' deleted.`,
                    "success",
                  );
                } else {
                  showToast(
                    "Error",
                    response.error || "Failed to delete prompt value.",
                    "danger",
                  );
                }
              },
              error: function (jqXHR) {
                const errorMsg = jqXHR.responseJSON
                  ? jqXHR.responseJSON.error
                  : "Server error deleting prompt value.";
                showToast("Error", errorMsg, "danger");
              },
            });
          }
        },
      );
    },
  );

  $("#btn-clear-all-prompt-values").on("click", function () {
    showToast(
      "Confirm",
      "Clear all prompt template values for this session?",
      "warning",
      true,
      function (confirmed) {
        if (confirmed) {
          console.log("Clearing all prompt template values.");
          $.ajax({
            url: "/api/settings/prompt_template_values/clear_all", // Endpoint to clear all values
            type: "POST",
            dataType: "json",
            success: function (response) {
              if (response && response.prompt_template_values !== undefined) {
                // Check for undefined for empty object
                currentPromptTemplateValues = response.prompt_template_values;
                renderPromptTemplateValuesTable();
                showToast(
                  "Success",
                  "All prompt template values cleared.",
                  "success",
                );
              } else {
                showToast(
                  "Error",
                  response.error || "Failed to clear prompt values.",
                  "danger",
                );
              }
            },
            error: function (jqXHR) {
              const errorMsg = jqXHR.responseJSON
                ? jqXHR.responseJSON.error
                : "Server error clearing prompt values.";
              showToast("Error", errorMsg, "danger");
            },
          });
        }
      },
    );
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
      e.preventDefault(); // Prevent default form submission if it's in a form
      const commandText = $(this).val().trim();
      if (commandText) {
        console.log("REPL command to send:", commandText);
        $("#repl-command-output").prepend(
          `<div class="text-info"><i class="fas fa-angle-right"></i> ${escapeHtml(commandText)}</div>`,
        );
        $(this).val(""); // Clear input

        // Send command to backend
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
