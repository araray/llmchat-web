// llmchat_web/static/js/custom.js

/**
 * @file custom.js
 * @description Custom JavaScript and jQuery for the llmchat-web interface.
 * This file handles client-side logic, DOM manipulation, event handling,
 * AJAX calls to the Flask backend, SSE for streaming chat, session management,
 * per-message actions, workspace item management, active context specification,
 * RAG controls, data ingestion (now with SSE for files), LLM settings,
 * direct RAG search, and prompt template values.
 */

// Global variable to store the current LLMCore session ID for the web client
let currentLlmSessionId = null;
// Global array to store items staged for active context
let stagedContextItems = []; // Each item: {spec_item_id: 'actx_XYZ', type: 'text_content'|'file_content'|'workspace_item'|'message_history', id_ref?: 'actual_ws_or_msg_id', content?: 'text content', path?: 'file_path', no_truncate?: boolean }

// Global state for RAG settings (mirrors Flask session, updated via API)
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
          showToast("LLMCore Error", status.llmcore_error, "danger");
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
      updateRagControlsState(); // Update UI elements based on new settings
      fetchAndPopulateRagCollections(); // Refresh collection dropdown, which also sets selected

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
        "Initialization Error",
        "Could not fetch initial server status. Some features may not work.",
        "danger",
      );
    },
  });
}

/**
 * Fetches and displays the list of available sessions.
 */
function fetchAndDisplaySessions() {
  console.log("Fetching sessions...");
  $.ajax({
    url: "/api/sessions",
    type: "GET",
    dataType: "json",
    success: function (sessions) {
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
    },
    error: function (jqXHR, textStatus, errorThrown) {
      console.error("Error fetching sessions:", textStatus, errorThrown);
      $("#session-list").html(
        '<p class="text-danger small m-2">Error loading sessions.</p>',
      );
    },
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
 * Fetches available RAG collections and populates the dropdown.
 */
function fetchAndPopulateRagCollections() {
  console.log("Fetching RAG collections...");
  $.ajax({
    url: "/api/rag/collections",
    type: "GET",
    dataType: "json",
    success: function (collections) {
      const $select = $("#rag-collection-select");
      $select
        .empty()
        .append('<option selected value="">Select Collection...</option>');
      if (collections && collections.length > 0) {
        collections.forEach(function (collection) {
          const collectionName =
            typeof collection === "string" ? collection : collection.name; // Adapt if API returns objects
          const collectionId =
            typeof collection === "string" ? collection : collection.id; // Adapt if API returns objects
          $select.append(
            $("<option>", {
              value: collectionId,
              text: escapeHtml(collectionName),
            }),
          );
        });
        if (currentRagSettings.collectionName) {
          $select.val(currentRagSettings.collectionName);
        }
      } else {
        $select.append(
          '<option value="" disabled>No collections found</option>',
        );
      }
    },
    error: function (jqXHR, textStatus, errorThrown) {
      console.error("Error fetching RAG collections:", textStatus, errorThrown);
      $("#rag-collection-select")
        .empty()
        .append('<option value="" disabled>Error loading collections</option>');
    },
  });
}

/**
 * Updates the state of RAG controls in the UI based on currentRagSettings.
 */
function updateRagControlsState() {
  $("#rag-toggle-switch").prop("checked", currentRagSettings.enabled);
  const controlsShouldBeDisabled = !currentRagSettings.enabled;
  $("#rag-collection-select").prop("disabled", controlsShouldBeDisabled);
  $("#rag-k-value")
    .prop("disabled", controlsShouldBeDisabled)
    .val(currentRagSettings.kValue || 3);
  $("#rag-filter-input")
    .prop("disabled", controlsShouldBeDisabled)
    .val(
      currentRagSettings.filter &&
        Object.keys(currentRagSettings.filter).length > 0
        ? JSON.stringify(currentRagSettings.filter)
        : "",
    ); // Display filter as JSON string

  const $ragStatusEl = $("#status-rag");
  if (currentRagSettings.enabled) {
    let statusText = `ON (${escapeHtml(currentRagSettings.collectionName) || "Default"}, K:${currentRagSettings.kValue || "Def"})`;
    if (
      currentRagSettings.filter &&
      Object.keys(currentRagSettings.filter).length > 0
    ) {
      statusText += " Filter*";
    }
    $ragStatusEl
      .text(statusText)
      .removeClass("bg-danger")
      .addClass("bg-success");
  } else {
    $ragStatusEl.text("OFF").removeClass("bg-success").addClass("bg-danger");
  }
}

/**
 * Sends updated RAG settings to the backend.
 */
function sendRagSettingsUpdate() {
  console.log("Sending RAG settings update to backend:", currentRagSettings);
  let filterToSend = currentRagSettings.filter;
  if (typeof filterToSend === "string" && filterToSend.trim() === "") {
    filterToSend = null;
  }

  const payload = {
    enabled: currentRagSettings.enabled,
    collectionName: currentRagSettings.collectionName,
    kValue: currentRagSettings.kValue,
    filter: filterToSend,
  };

  $.ajax({
    url: "/api/settings/rag/update",
    type: "POST",
    contentType: "application/json",
    data: JSON.stringify(payload),
    dataType: "json",
    success: function (response) {
      console.log("RAG settings updated successfully on backend:", response);
      if (response && response.rag_settings) {
        currentRagSettings = response.rag_settings;
        // Ensure filter is stored as an object or null locally
        if (typeof currentRagSettings.filter === "string") {
          try {
            currentRagSettings.filter = JSON.parse(currentRagSettings.filter);
          } catch (e) {
            console.warn(
              "Could not parse filter string from backend, setting to null",
              e,
            );
            currentRagSettings.filter = null;
          }
        }
      }
      updateRagControlsState();
    },
    error: function (jqXHR, textStatus, errorThrown) {
      console.error(
        "Error updating RAG settings on backend:",
        textStatus,
        errorThrown,
      );
      showToast(
        "Error",
        "Failed to update RAG settings on the server.",
        "danger",
      );
    },
  });
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

/**
 * Handles the submission of the Direct RAG Search form.
 */
function handleDirectRagSearch() {
  const query = $("#direct-rag-search-query").val().trim();
  if (!query) {
    showToast(
      "Error",
      "Please enter a search query for Direct RAG Search.",
      "danger",
    );
    return;
  }
  const payload = {
    query: query,
    collection_name: currentRagSettings.collectionName,
    k: currentRagSettings.kValue,
    filter: currentRagSettings.filter,
  };

  console.log("Performing Direct RAG Search with payload:", payload);
  $("#directRagSearchResultsBody").html(
    '<p class="text-muted">Searching...</p>',
  );
  var searchModal = new bootstrap.Modal(
    document.getElementById("directRagSearchResultsModal"),
  );
  searchModal.show();

  $.ajax({
    url: "/api/rag/direct_search",
    type: "POST",
    contentType: "application/json",
    data: JSON.stringify(payload),
    dataType: "json",
    success: function (results) {
      console.log("Direct RAG Search results:", results);
      renderDirectRagSearchResults(results);
    },
    error: function (jqXHR, textStatus, errorThrown) {
      console.error("Direct RAG Search error:", textStatus, errorThrown);
      const errorMsg = jqXHR.responseJSON
        ? jqXHR.responseJSON.error
        : "Failed to perform RAG search.";
      $("#directRagSearchResultsBody").html(
        `<p class="text-danger">Error: ${escapeHtml(errorMsg)}</p>`,
      );
      showToast("Error", `Direct RAG Search failed: ${errorMsg}`, "danger");
    },
  });
}

/**
 * Renders the results of a Direct RAG Search into the modal.
 * @param {Array} results - Array of document objects from the backend.
 */
function renderDirectRagSearchResults(results) {
  const $modalBody = $("#directRagSearchResultsBody").empty();
  if (!results || results.length === 0) {
    $modalBody.append(
      '<p class="text-muted">No results found for your query.</p>',
    );
    return;
  }

  const $listGroup = $('<ul class="list-group list-group-flush"></ul>');
  results.forEach(function (doc) {
    const scoreDisplay =
      doc.score !== null && doc.score !== undefined
        ? `<strong>Score:</strong> ${doc.score.toFixed(4)}`
        : "Score: N/A";
    const metadataDisplay = doc.metadata
      ? `<small class="text-muted d-block">Metadata: ${escapeHtml(JSON.stringify(doc.metadata).substring(0, 100))}...</small>`
      : "";
    const contentPreview = doc.content
      ? `<pre>${escapeHtml(doc.content.substring(0, 250))}${doc.content.length > 250 ? "..." : ""}</pre>`
      : '<p class="text-muted small">No content preview.</p>';

    const $listItem = $(`
            <li class="list-group-item">
                <div><strong>ID:</strong> ${escapeHtml(doc.id)}</div>
                <div>${scoreDisplay}</div>
                ${metadataDisplay}
                <div class="mt-1">Content Preview:</div>
                ${contentPreview}
            </li>
        `);
    $listGroup.append($listItem);
  });
  $modalBody.append($listGroup);
}

/**
 * Handles the submission of ingestion forms.
 * For 'file' type, it now uses fetch for SSE.
 * For other types, it still uses AJAX (can be updated later).
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

  if (
    ingestType === "file" ||
    ingestType === "dir_zip" ||
    ingestType === "git"
  ) {
    // Make all types use SSE
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
          // Final update might come from 'ingestion_complete' event
          if (
            $progressBar.text() !== "Complete!" &&
            $progressBar.text() !== "Failed!" &&
            $progressBar.text() !== "Completed with Errors!" // Added this check
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
                  eventData.total_files || totalFilesFromEvent; // Update total if provided
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
                  $progressBar.addClass("bg-warning"); // Mark progress as having issues
                }
              } else if (eventData.type === "ingestion_start") {
                // For dir_zip and git
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
                fetchAndPopulateRagCollections(); // Refresh collections list
                setTimeout(() => $progressContainer.fadeOut(), 3000); // Increased timeout
              } else if (eventData.type === "error") {
                throw new Error(eventData.error); // Throw to be caught by outer catch
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
                  setTimeout(() => $progressContainer.fadeOut(), 3000); // Increased timeout
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
      setTimeout(() => $progressContainer.fadeOut(), 3000); // Increased timeout
    }
  } else {
    // This block should ideally not be reached if all types are SSE
    console.warn(
      `Ingest type ${ingestType} not configured for SSE, using AJAX fallback. (This should not happen)`,
    );
    // ... (original AJAX fallback, though it's better to ensure all types use SSE)
  }
}

$(document).ready(function () {
  console.log("LLMChat Web: custom.js loaded and DOM ready.");

  if ($("#toast-container").length === 0) {
    $("body").append(
      '<div id="toast-container" class="toast-container position-fixed top-0 end-0 p-3" style="z-index: 1056"></div>',
    );
  }

  fetchAndUpdateInitialStatus(); // This is the call that was failing.

  // Event handlers from the original custom.js, adapted to use global state variables
  // and new/updated functions.

  $("#btn-new-session").on("click", function () {
    console.log("New session button clicked.");
    $.ajax({
      url: "/api/sessions/new",
      type: "POST",
      dataType: "json",
      success: function (newSessionResponse) {
        // Renamed variable
        console.log("New session created:", newSessionResponse);
        currentLlmSessionId = newSessionResponse.id; // Assuming 'id' is directly on the response
        $("#chat-messages")
          .empty()
          .append(
            '<div class="message-bubble agent-message">New session started.</div>',
          );
        // Update global JS state from newSessionResponse.rag_settings, .llm_settings, .prompt_template_values
        if (newSessionResponse.rag_settings)
          currentRagSettings = newSessionResponse.rag_settings;
        if (newSessionResponse.llm_settings)
          currentLlmSettings = newSessionResponse.llm_settings;
        if (newSessionResponse.prompt_template_values)
          currentPromptTemplateValues =
            newSessionResponse.prompt_template_values;

        fetchAndDisplaySessions(); // Refresh session list
        // Update UI based on the new global states
        updateRagControlsState();
        fetchAndPopulateLlmProviders(); // This will also handle models and system message via currentLlmSettings
        fetchAndDisplaySystemMessage();
        renderPromptTemplateValuesTable();
        updateContextUsageDisplay(null); // Reset context usage for new session

        stagedContextItems = [];
        renderStagedContextItems();
        if ($("#context-manager-tab-btn").hasClass("active")) {
          fetchAndDisplayWorkspaceItems();
        }
      },
      error: function (jqXHR, textStatus, errorThrown) {
        console.error("Error creating new session:", textStatus, errorThrown);
        showToast("Error", "Failed to create new session.", "danger");
      },
    });
  });
  $("#session-list").on("click", ".list-group-item", function (e) {
    e.preventDefault();
    const sessionIdToLoad = $(this).data("session-id");
    console.log(`Loading session: ${sessionIdToLoad}`);
    $.ajax({
      url: `/api/sessions/${sessionIdToLoad}/load`,
      type: "GET",
      dataType: "json",
      success: function (response) {
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
            appendMessageToChat(msg.content, msg.role, false, msg.id);
          });
        } else {
          $("#chat-messages").append(
            '<div class="message-bubble agent-message">Session loaded. No messages yet.</div>',
          );
        }

        // Update global JS state from appliedSettings
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

        fetchAndDisplaySessions(); // Refresh session list (highlights active)
        // Update UI based on the new global states
        // These are now more directly updated from appliedSettings
        $("#status-provider").text(currentLlmSettings.providerName || "N/A");
        $("#status-model").text(currentLlmSettings.modelName || "N/A");
        $("#system-message-input").val(currentLlmSettings.systemMessage);
        if (
          $("#llm-provider-select").val() !== currentLlmSettings.providerName
        ) {
          $("#llm-provider-select").val(currentLlmSettings.providerName);
          fetchAndPopulateLlmModels(currentLlmSettings.providerName); // This will also set model dropdown
        } else if (
          $("#llm-model-select").val() !== currentLlmSettings.modelName
        ) {
          $("#llm-model-select").val(currentLlmSettings.modelName);
        }

        updateRagControlsState(); // Updates RAG UI from currentRagSettings
        if (
          $("#rag-collection-select").val() !==
          currentRagSettings.collectionName
        ) {
          fetchAndPopulateRagCollections(); // This will also set collection dropdown
        }

        renderPromptTemplateValuesTable(); // Updates prompt values table
        updateContextUsageDisplay(null); // Or try to get from session if available

        stagedContextItems = []; // Clear client-side staged items for new session
        renderStagedContextItems();
        if ($("#context-manager-tab-btn").hasClass("active")) {
          fetchAndDisplayWorkspaceItems();
        }
      },
      error: function (jqXHR, textStatus, errorThrown) {
        console.error("Error loading session:", textStatus, errorThrown);
        showToast("Error", "Failed to load session.", "danger");
      },
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
          $.ajax({
            url: `/api/sessions/${currentLlmSessionId}`,
            type: "DELETE",
            dataType: "json",
            success: function (response) {
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
              fetchAndDisplaySessions(); // Refresh list
              // Call fetchAndUpdateInitialStatus to reset to defaults or a new temp session state
              fetchAndUpdateInitialStatus();
              stagedContextItems = [];
              renderStagedContextItems();
              if ($("#context-manager-tab-btn").hasClass("active")) {
                fetchAndDisplayWorkspaceItems(); // This might show "no active session"
              }
            },
            error: function (jqXHR, textStatus, errorThrown) {
              console.error("Error deleting session:", textStatus, errorThrown);
              showToast("Error", "Failed to delete session.", "danger");
            },
          });
        }
      },
    );
  });

  $("#send-chat-message").on("click", function () {
    sendMessage();
  });
  $("#chat-input").on("keypress", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  async function sendMessage() {
    const messageText = $("#chat-input").val().trim();
    if (!messageText) return;
    if (!currentLlmSessionId) {
      showToast(
        "Error",
        "No active session. Please start or load a session.",
        "danger",
      );
      return;
    }

    appendMessageToChat(messageText, "user");
    $("#chat-input").val("");
    updateChatInputTokenEstimate();

    const agentMessageElementId = `agent-msg-${Date.now()}`;
    appendMessageToChat(
      "Thinking...",
      "agent",
      false,
      null,
      agentMessageElementId,
    );

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: messageText,
          session_id: currentLlmSessionId,
          stream: true,
          active_context_specification: stagedContextItems,
        }),
      });

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ error: "Unknown server error" }));
        console.error("Chat API error response:", errorData);
        $(`#${agentMessageElementId}`).html(
          `<span class="text-danger">Error: ${escapeHtml(errorData.error || response.statusText)}</span>`,
        );
        updateContextUsageDisplay(null);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulatedContent = "";
      let persistentMsgId = null;
      const actionsHtml = `
          <div class="message-actions mt-1">
              <button class="btn btn-sm btn-outline-light btn-copy-message" title="Copy"><i class="fas fa-copy fa-xs"></i></button>
              <button class="btn btn-sm btn-outline-light btn-add-workspace" title="Add to Workspace"><i class="fas fa-plus-square fa-xs"></i></button>
              <button class="btn btn-sm btn-outline-light btn-delete-message" title="Delete Message"><i class="fas fa-trash fa-xs"></i></button>
          </div>`;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let eolIndex;
        while ((eolIndex = buffer.indexOf("\n\n")) >= 0) {
          const line = buffer.substring(0, eolIndex).trim();
          buffer = buffer.substring(eolIndex + 2);

          if (line.startsWith("data: ")) {
            try {
              const eventData = JSON.parse(line.substring(6));
              if (eventData.type === "chunk") {
                accumulatedContent += eventData.content;
                $(`#${agentMessageElementId}`).html(
                  escapeHtml(accumulatedContent),
                );
              } else if (
                eventData.type === "full_response_id" &&
                eventData.message_id
              ) {
                persistentMsgId = eventData.message_id;
                $(`#${agentMessageElementId}`).attr(
                  "data-message-id",
                  persistentMsgId,
                );
                if (
                  $(`#${agentMessageElementId}`).find(".message-actions")
                    .length === 0
                ) {
                  $(`#${agentMessageElementId}`).append(actionsHtml);
                }
              } else if (eventData.type === "context_usage" && eventData.data) {
                updateContextUsageDisplay(eventData.data);
              } else if (eventData.type === "end") {
                console.log("Stream ended by server.");
                if (
                  !persistentMsgId &&
                  $(`#${agentMessageElementId}`).attr("data-message-id")
                ) {
                  persistentMsgId = $(`#${agentMessageElementId}`).attr(
                    "data-message-id",
                  );
                }
                if (
                  persistentMsgId &&
                  $(`#${agentMessageElementId}`).find(".message-actions")
                    .length === 0
                ) {
                  $(`#${agentMessageElementId}`).append(actionsHtml);
                }
                return;
              } else if (eventData.type === "error") {
                console.error("SSE Error Event:", eventData.error);
                $(`#${agentMessageElementId}`).html(
                  `<span class="text-danger">Stream Error: ${escapeHtml(eventData.error)}</span>`,
                );
                return;
              }
            } catch (e) {
              console.warn("Error parsing SSE event data:", e, "Line:", line);
            }
          }
        }
      }
      // Final update of content and actions if not already done by 'end' or 'full_response_id'
      $(`#${agentMessageElementId}`).html(escapeHtml(accumulatedContent));
      if (
        !$(`#${agentMessageElementId}`).attr("data-message-id") &&
        persistentMsgId
      ) {
        $(`#${agentMessageElementId}`).attr("data-message-id", persistentMsgId);
      }
      if (
        $(`#${agentMessageElementId}`).attr("data-message-id") &&
        $(`#${agentMessageElementId}`).find(".message-actions").length === 0
      ) {
        $(`#${agentMessageElementId}`).append(actionsHtml);
      }
    } catch (error) {
      console.error("Error sending message:", error);
      $(`#${agentMessageElementId}`).html(
        `<span class="text-danger">Error: Could not connect to chat service. ${escapeHtml(error.message || "")}</span>`,
      );
      updateContextUsageDisplay(null);
    }
  }

  function appendMessageToChat(
    text,
    sender,
    isError = false,
    persistentMessageId = null,
    elementIdOverride = null,
  ) {
    const $chatMessages = $("#chat-messages");
    const messageId =
      elementIdOverride ||
      `msg-elem-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const $messageDiv = $("<div>", {
      id: messageId,
      class: `message-bubble ${sender === "user" ? "user-message" : "agent-message"} ${isError ? "error-message-bubble" : ""}`,
      html: escapeHtml(text), // Ensure text is escaped
    });

    if (persistentMessageId) {
      $messageDiv.attr("data-message-id", persistentMessageId);
      const actionsHtml = `
            <div class="message-actions mt-1">
                <button class="btn btn-sm btn-outline-light btn-copy-message" title="Copy"><i class="fas fa-copy fa-xs"></i></button>
                <button class="btn btn-sm btn-outline-light btn-add-workspace" title="Add to Workspace"><i class="fas fa-plus-square fa-xs"></i></button>
                <button class="btn btn-sm btn-outline-light btn-delete-message" title="Delete Message"><i class="fas fa-trash fa-xs"></i></button>
            </div>`;
      $messageDiv.append(actionsHtml);
    }

    $chatMessages.prepend($messageDiv);
    return messageId;
  }

  $("#chat-messages").on("click", ".btn-copy-message", function () {
    const messageContent = $(this)
      .closest(".message-bubble")
      .clone()
      .children(".message-actions")
      .remove()
      .end()
      .text()
      .trim();
    navigator.clipboard
      .writeText(messageContent)
      .then(() => {
        showToast("Copied!", "Message content copied to clipboard.", "success");
      })
      .catch((err) => {
        console.error("Failed to copy message: ", err);
        showToast("Error", "Failed to copy message to clipboard.", "danger");
      });
  });
  $("#chat-messages").on("click", ".btn-add-workspace", function () {
    const messageId = $(this).closest(".message-bubble").data("message-id");
    if (!messageId || !currentLlmSessionId) {
      showToast(
        "Error",
        "Cannot add to workspace: Message ID or Session ID is missing.",
        "danger",
      );
      return;
    }
    console.log(
      `Adding message ${messageId} to workspace for session ${currentLlmSessionId}`,
    );
    $.ajax({
      url: `/api/sessions/${currentLlmSessionId}/workspace/add_from_message`,
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify({ message_id: messageId }),
      dataType: "json",
      success: function (response) {
        console.log("Add to workspace response:", response);
        showToast(
          "Success",
          `Message added to workspace as item: ${escapeHtml(response.id)}`,
          "success",
        );
        if ($("#context-manager-tab-btn").hasClass("active")) {
          fetchAndDisplayWorkspaceItems();
        }
      },
      error: function (jqXHR, textStatus, errorThrown) {
        console.error(
          "Error adding message to workspace:",
          textStatus,
          errorThrown,
        );
        const errorMsg = jqXHR.responseJSON
          ? jqXHR.responseJSON.error
          : "Failed to add message to workspace.";
        showToast("Error", errorMsg, "danger");
      },
    });
  });
  $("#chat-messages").on("click", ".btn-delete-message", function () {
    const $messageBubble = $(this).closest(".message-bubble");
    const messageId = $messageBubble.data("message-id");
    if (!messageId || !currentLlmSessionId) {
      showToast(
        "Error",
        "Cannot delete message: Message ID or Session ID is missing.",
        "danger",
      );
      return;
    }
    showToast(
      "Confirm",
      `Delete message ${messageId}? This cannot be undone.`,
      "warning",
      true,
      function (confirmed) {
        if (confirmed) {
          console.log(
            `Deleting message ${messageId} from session ${currentLlmSessionId}`,
          );
          $.ajax({
            url: `/api/sessions/${currentLlmSessionId}/messages/${messageId}`,
            type: "DELETE",
            dataType: "json",
            success: function (response) {
              console.log("Delete message response:", response);
              showToast(
                "Success",
                response.message || "Message deleted successfully.",
                "success",
              );
              $messageBubble.fadeOut(function () {
                $(this).remove();
              });
            },
            error: function (jqXHR, textStatus, errorThrown) {
              console.error("Error deleting message:", textStatus, errorThrown);
              const errorMsg = jqXHR.responseJSON
                ? jqXHR.responseJSON.error
                : "Failed to delete message.";
              showToast("Error", errorMsg, "danger");
            },
          });
        }
      },
    );
  });

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

  $("#rag-tab-btn").on("shown.bs.tab", function () {
    fetchAndPopulateRagCollections();
    updateRagControlsState();
  });
  $("#rag-toggle-switch").on("change", function () {
    currentRagSettings.enabled = $(this).is(":checked");
    sendRagSettingsUpdate();
  });
  $("#rag-collection-select").on("change", function () {
    currentRagSettings.collectionName = $(this).val() || null;
    sendRagSettingsUpdate();
  });
  $("#rag-k-value").on("change", function () {
    const val = parseInt($(this).val(), 10);
    currentRagSettings.kValue = isNaN(val) ? 3 : val;
    sendRagSettingsUpdate();
  });
  $("#rag-k-value").on("input", function () {}); // Keep for potential future live updates
  $("#rag-filter-input").on("change", function () {
    const filterStr = $(this).val().trim();
    if (filterStr === "") {
      currentRagSettings.filter = null;
    } else {
      try {
        const parsedFilter = JSON.parse(filterStr);
        if (typeof parsedFilter === "object" && parsedFilter !== null) {
          currentRagSettings.filter = parsedFilter;
        } else {
          showToast(
            "Error",
            'Invalid JSON for RAG filter. It must be an object (e.g., {"key": "value"}).',
            "danger",
          );
          $(this).val(
            currentRagSettings.filter &&
              Object.keys(currentRagSettings.filter).length > 0
              ? JSON.stringify(currentRagSettings.filter)
              : "",
          );
          return;
        }
      } catch (e) {
        showToast("Error", "Invalid JSON format for RAG filter.", "danger");
        $(this).val(
          currentRagSettings.filter &&
            Object.keys(currentRagSettings.filter).length > 0
            ? JSON.stringify(currentRagSettings.filter)
            : "",
        );
        return;
      }
    }
    sendRagSettingsUpdate();
  });

  $("#direct-rag-search-form").on("submit", function (e) {
    e.preventDefault();
    handleDirectRagSearch();
  });

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
    handleIngestionFormSubmit("file", formData); // Will use fetch for SSE
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
    handleIngestionFormSubmit("dir_zip", formData); // Will use fetch for SSE
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
    handleIngestionFormSubmit("git", formData); // Will use fetch for SSE
  });

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

  $("#chat-input").on("input", function () {
    updateChatInputTokenEstimate();
  });
  function updateChatInputTokenEstimate() {
    const text = $("#chat-input").val();
    const estimatedTokens = Math.ceil(text.length / 4);
    $("#chat-input-token-estimate").text(`Tokens: ~${estimatedTokens}`);
  }
  updateChatInputTokenEstimate();

  $("#repl-command-input").on("keypress", function (e) {
    if (e.key === "Enter") {
      const commandText = $(this).val().trim();
      if (commandText) {
        console.log("REPL command entered (UI):", commandText);
        $("#repl-command-output").prepend(
          `<div class="text-info"><i class="fas fa-angle-right"></i> ${escapeHtml(commandText)}</div>`,
        );
        $("#repl-command-output").prepend(
          `<div class="text-warning">  <i class="fas fa-spinner fa-spin"></i> Processing REPL command (not yet implemented)...</div>`,
        );
        $(this).val("");
      }
    }
  });

  console.log("LLMChat Web REPL UI initialized (client-side).");
});
