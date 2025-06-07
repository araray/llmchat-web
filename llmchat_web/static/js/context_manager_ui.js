// llmchat_web/static/js/context_manager_ui.js

/**
 * @file context_manager_ui.js
 * @description Handles UI logic for the Context Manager tab, including workspace items,
 * active context specification, history context selection, and context preview.
 * This version adds support for the "UI Managed" Prompt Workbench mode and
 * introduces a debounced function to update the global context token count in real-time.
 * Depends on utils.js and accesses/modifies global state from main_controller.js.
 */

// Debounce timers to avoid excessive API calls
let tokenEstimateDebounceTimer;
let fullContextPreviewDebounceTimer;

// =================================================================================
// SECTION: Full Context Preview (for Top Bar Token Count)
// =================================================================================

/**
 * Fetches a full context preview from the backend to get an accurate token count.
 * This function is debounced to avoid excessive API calls during rapid UI changes.
 * It updates the main context usage display in the top bar.
 * Relies on global state variables for session ID, staged items, and all settings.
 */
function updateFullContextPreview() {
  clearTimeout(fullContextPreviewDebounceTimer);
  fullContextPreviewDebounceTimer = setTimeout(async () => {
    if (!window.currentLlmSessionId) {
      // Don't try to update if there's no session active
      return;
    }

    // Don't run this preview if in UI Managed mode, as the context is different.
    const isUIManaged = $("#context-mode-toggle").is(":checked");
    if (isUIManaged) {
      return;
    }

    const payload = {
      // The user's current query from the main chat input affects context
      current_query: $("#chat-input").val() || "",
      staged_items: window.stagedContextItems || [],
      // RAG and LLM settings are read from the Flask session on the backend,
      // so we don't need to send them all explicitly. The backend /api/context/preview
      // endpoint is designed to use the current session's settings.
    };

    try {
      const response = await fetch(
        `/api/sessions/${window.currentLlmSessionId}/context/preview`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        // Silently fail in the UI to not bother the user. Log to console.
        const errData = await response.json().catch(() => ({}));
        console.warn(
          "CTX_MAN_UI: Failed to fetch full context preview for token count:",
          errData.error || "API error",
        );
        return;
      }

      const data = await response.json();
      // The `updateContextUsageDisplay` function is in utils.js
      if (typeof updateContextUsageDisplay === "function") {
        updateContextUsageDisplay(data);
      }
    } catch (error) {
      console.warn(
        "CTX_MAN_UI: Network error fetching full context preview:",
        error,
      );
    }
  }, 500); // 500ms debounce delay
}

// =================================================================================
// SECTION: UI Mode Switching (LLMCore Managed vs. UI Managed)
// =================================================================================

/**
 * Toggles the visibility of UI sections based on the selected context management mode.
 */
function switchContextManagerMode() {
  const isUIManaged = $("#context-mode-toggle").is(":checked");
  console.log(`CTX_MAN_UI: Switching context mode. UI Managed: ${isUIManaged}`);

  if (isUIManaged) {
    $("#llmcore-managed-context-ui").hide();
    $("#ui-managed-context-ui").show();
    updatePromptWorkbenchTokenEstimate(); // Initial token count
  } else {
    $("#ui-managed-context-ui").hide();
    $("#llmcore-managed-context-ui").show();
    // Refresh the LLMCore managed view if it was hidden
    if ($("#workspace-subtab-btn").hasClass("active")) {
      fetchAndDisplayWorkspaceItems();
      renderStagedContextItems();
    } else if ($("#history-subtab-btn").hasClass("active")) {
      fetchAndDisplayHistoryContext();
    }
    updateFullContextPreview(); // Trigger a context preview update when switching back
  }
}

// =================================================================================
// SECTION: Prompt Workbench (UI Managed Mode)
// =================================================================================

/**
 * Estimates the token count for the content in the Prompt Workbench.
 * It sends the text to the backend's token estimation endpoint and updates the UI.
 * This function is debounced to prevent API calls on every keystroke.
 */
function updatePromptWorkbenchTokenEstimate() {
  clearTimeout(tokenEstimateDebounceTimer);
  tokenEstimateDebounceTimer = setTimeout(async () => {
    const text = $("#prompt-workbench-textarea").val();
    const $tokenDisplay = $("#prompt-workbench-token-count");

    if (!text) {
      $tokenDisplay.text("Tokens: 0");
      return;
    }

    // Use globally managed provider/model names
    const providerName = window.currentLlmSettings?.providerName;
    const modelName = window.currentLlmSettings?.modelName;

    if (!providerName) {
      $tokenDisplay.text("Tokens: (select provider)");
      return;
    }

    $tokenDisplay.text("Tokens: Calculating...");

    try {
      const response = await fetch("/api/utils/estimate_tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text,
          provider_name: providerName,
          model_name: modelName,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Failed to fetch token count");
      }

      const data = await response.json();
      $tokenDisplay.text(`Tokens: ~${data.token_count}`);
    } catch (error) {
      console.error(
        "CTX_MAN_UI: Error estimating prompt workbench tokens:",
        error,
      );
      $tokenDisplay.text("Tokens: Error");
      showToast("Token Count Error", error.message, "danger");
    }
  }, 300); // 300ms debounce delay
}

// =================================================================================
// SECTION: Workspace & Staging Management (LLMCore Managed Mode)
// =================================================================================

/**
 * Fetches and displays workspace items for the current session.
 * Relies on global `currentLlmSessionId` from main_controller.js.
 */
function fetchAndDisplayWorkspaceItems() {
  if (!window.currentLlmSessionId) {
    $("#workspace-items-list").html(
      '<p class="text-muted p-2">No active session to load workspace items from.</p>',
    );
    return;
  }
  console.log(
    `CTX_MAN_UI: Fetching workspace items for session: ${window.currentLlmSessionId}`,
  );
  $.ajax({
    url: `/api/sessions/${window.currentLlmSessionId}/workspace/items`,
    type: "GET",
    dataType: "json",
    success: function (items) {
      console.log("CTX_MAN_UI: Workspace items received:", items);
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
            "data-item-content-preview": item.content,
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
          // New button to add content to the prompt workbench
          $actions.append(
            $("<button>", {
              class:
                "btn btn-sm btn-outline-secondary me-1 btn-add-to-workbench",
              title: "Add to Prompt Workbench",
            }).html('<i class="fas fa-file-import fa-xs"></i> To Workbench'),
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
      console.error(
        "CTX_MAN_UI: Error fetching workspace items:",
        textStatus,
        errorThrown,
      );
      $("#workspace-items-list").html(
        '<p class="text-danger small p-2">Error loading workspace items.</p>',
      );
    },
  });
}

/**
 * Renders the staged context items in the UI.
 * Relies on global `stagedContextItems` from main_controller.js.
 */
function renderStagedContextItems() {
  const $list = $("#active-context-spec-list").empty();
  if (window.stagedContextItems.length === 0) {
    $list.append(
      '<p class="text-muted p-2">No items staged for active context.</p>',
    );
    return;
  }
  window.stagedContextItems.forEach(function (item, index) {
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
  console.log("CTX_MAN_UI: Staged context items rendered.");
}

/**
 * Adds an item to the global `stagedContextItems` array and re-renders the list.
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
  window.stagedContextItems.push({
    spec_item_id: spec_item_id,
    type: type,
    id_ref: id_ref,
    content: content,
    path: path,
    no_truncate: no_truncate,
  });
  renderStagedContextItems();
  updateFullContextPreview(); // Trigger update on change
  console.log(
    "CTX_MAN_UI: Added to staged items:",
    window.stagedContextItems[window.stagedContextItems.length - 1],
  );
}

/**
 * Removes an item from the global `stagedContextItems` array by its spec_item_id and re-renders.
 * @param {string} spec_item_id_to_remove - The unique ID of the staged item to remove.
 */
function removeStagedContextItem(spec_item_id_to_remove) {
  window.stagedContextItems = window.stagedContextItems.filter(
    (item) => item.spec_item_id !== spec_item_id_to_remove,
  );
  renderStagedContextItems();
  updateFullContextPreview(); // Trigger update on change
  console.log(
    `CTX_MAN_UI: Removed staged item ${spec_item_id_to_remove}. Remaining:`,
    window.stagedContextItems,
  );
}

// =================================================================================
// SECTION: History Context Management
// =================================================================================

/**
 * Renders the list of session messages with checkboxes for context inclusion.
 * @param {Array<Object>} messages - The array of message objects from the session.
 * @param {Object} messageInclusionMap - A map of messageId -> boolean indicating inclusion state.
 */
function renderHistoryContextList(messages, messageInclusionMap = {}) {
  const $list = $("#history-context-message-list").empty();
  if (!messages || messages.length === 0) {
    $list.html(
      '<p class="text-muted p-2">No messages in this session yet.</p>',
    );
    return;
  }
  messages.forEach(function (msg) {
    // Default to true (checked) if a message is not in the map
    const isChecked = messageInclusionMap[msg.id] !== false;
    const contentPreview = msg.content
      ? msg.content.substring(0, 150) + (msg.content.length > 150 ? "..." : "")
      : "[Empty message]";
    const roleClass =
      msg.role === "user"
        ? "text-primary"
        : msg.role === "assistant"
          ? "text-info"
          : "text-secondary";

    const $itemDiv = $("<div>", {
      class: "form-check history-context-item",
      "data-message-id": msg.id,
      "data-message-content": msg.content, // Store full content
    });
    const $checkbox = $("<input>", {
      class: "form-check-input",
      type: "checkbox",
      id: `history-check-${msg.id}`,
      "data-message-id": msg.id,
      checked: isChecked,
    });
    const $label = $("<label>", {
      class: "form-check-label",
      for: `history-check-${msg.id}`,
      html: `<strong class="${roleClass}">${escapeHtml(msg.role.toUpperCase())}:</strong> ${escapeHtml(contentPreview)}`,
    });
    // Button to add message content to workbench
    const $toWorkbenchBtn = $("<button>", {
      class: "btn btn-sm btn-outline-secondary ms-2 btn-add-to-workbench",
      title: "Add message content to Prompt Workbench",
      html: '<i class="fas fa-file-import fa-xs"></i>',
    });

    $itemDiv.append($checkbox, $label, $toWorkbenchBtn);
    $list.append($itemDiv);
  });
  console.log("CTX_MAN_UI: History context list rendered.");
}

/**
 * Fetches the current session data and displays the history context management UI.
 */
function fetchAndDisplayHistoryContext() {
  if (!window.currentLlmSessionId) {
    $("#history-context-message-list").html(
      '<p class="text-muted p-2">No active session.</p>',
    );
    return;
  }
  console.log(
    `CTX_MAN_UI: Fetching full session for history context: ${window.currentLlmSessionId}`,
  );
  // Use the session_api.js helper function
  apiLoadSession(window.currentLlmSessionId)
    .done(function (response) {
      if (response && response.session_data) {
        const session = response.session_data;
        // The inclusion map is stored in the client-specific metadata
        const clientData = session.metadata?.client_data || {};
        const messageInclusionMap = clientData.message_inclusion_map || {};
        renderHistoryContextList(session.messages, messageInclusionMap);
      } else {
        $("#history-context-message-list").html(
          '<p class="text-danger p-2">Could not load session data.</p>',
        );
      }
    })
    .fail(function (jqXHR) {
      console.error(
        "CTX_MAN_UI: Error fetching session for history context:",
        jqXHR.responseJSON,
      );
      $("#history-context-message-list").html(
        '<p class="text-danger p-2">Error loading session data.</p>',
      );
    });
}

// =================================================================================
// SECTION: Context Preview
// =================================================================================

/**
 * Renders the content of the context preview modal.
 * @param {object} data - The context preview data from the backend.
 */
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
    `<p class="mb-1"><small class="text-muted">Provider: ${escapeHtml(data.provider_name) || "N/A"}, Model: ${escapeHtml(data.model_name) || "N/A"}</small></p>`,
  );
  $display.append(
    `<p class="mb-1"><small class="text-muted">Max Tokens: ${data.max_tokens_for_model || "N/A"}, Final Token Count: <strong>${data.final_token_count || "N/A"}</strong></small></p>`,
  );

  if (
    data.truncation_actions_taken &&
    data.truncation_actions_taken.details &&
    data.truncation_actions_taken.details.length > 0
  ) {
    $display.append(`<h6><i class="fas fa-cut"></i> Truncation Actions:</h6>`);
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
    const $msgList = $('<div class="list-group list-group-flush mb-3"></div>');
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
  console.log("CTX_MAN_UI: Context preview modal rendered.");
}

// =================================================================================
// SECTION: Event Listeners
// =================================================================================

/**
 * Initializes event listeners for the Context Manager tab.
 */
function initContextManagerEventListeners() {
  // --- Mode Toggle ---
  $("#context-mode-toggle").on("change", switchContextManagerMode);

  // --- Prompt Workbench Listener ---
  $("#prompt-workbench-textarea").on(
    "input",
    updatePromptWorkbenchTokenEstimate,
  );

  // --- LLMCore Managed UI Event Listeners ---
  $("#context-manager-tab-btn").on("shown.bs.tab", function (e) {
    const isUIManaged = $("#context-mode-toggle").is(":checked");
    if (!isUIManaged) {
      if ($("#workspace-subtab-btn").hasClass("active")) {
        fetchAndDisplayWorkspaceItems();
        renderStagedContextItems();
      } else if ($("#history-subtab-btn").hasClass("active")) {
        fetchAndDisplayHistoryContext();
      }
      updateFullContextPreview();
    } else {
      updatePromptWorkbenchTokenEstimate();
    }
  });

  // Handle switching between the new sub-tabs
  $("#workspace-subtab-btn").on("shown.bs.tab", function () {
    fetchAndDisplayWorkspaceItems();
    renderStagedContextItems();
    updateFullContextPreview();
  });

  $("#history-subtab-btn").on("shown.bs.tab", function () {
    fetchAndDisplayHistoryContext();
    updateFullContextPreview();
  });

  // ... (existing listeners for workspace, staging, history, preview) ...
  // The following listeners remain the same as they operate on the LLMCore Managed UI.
  // A new listener is added for the "Add to Workbench" button.

  $("#workspace-items-list").on("click", ".btn-add-to-workbench", function () {
    const $itemDiv = $(this).closest(".workspace-item");
    const itemId = $itemDiv.data("item-id");
    if (!itemId || !window.currentLlmSessionId) return;

    $.ajax({
      url: `/api/sessions/${window.currentLlmSessionId}/workspace/items/${itemId}`,
      type: "GET",
      dataType: "json",
      success: function (item) {
        const currentWorkbenchContent = $("#prompt-workbench-textarea").val();
        const newContent =
          (currentWorkbenchContent ? currentWorkbenchContent + "\n\n" : "") +
          item.content;
        $("#prompt-workbench-textarea").val(newContent).trigger("input"); // Trigger token update
        showToast(
          "Added to Workbench",
          `Content from item ${itemId} has been added.`,
          "success",
        );
        // Optional: Switch to UI Managed mode if not already active
        if (!$("#context-mode-toggle").is(":checked")) {
          $("#context-mode-toggle").prop("checked", true).trigger("change");
        }
      },
      error: function () {
        showToast(
          "Error",
          "Could not fetch item content to add to workbench.",
          "danger",
        );
      },
    });
  });

  $("#history-context-message-list").on(
    "click",
    ".btn-add-to-workbench",
    function () {
      const content = $(this)
        .closest(".history-context-item")
        .data("message-content");
      if (content) {
        const currentWorkbenchContent = $("#prompt-workbench-textarea").val();
        const newContent =
          (currentWorkbenchContent ? currentWorkbenchContent + "\n\n" : "") +
          content;
        $("#prompt-workbench-textarea").val(newContent).trigger("input");
        showToast("Added to Workbench", `Message content added.`, "success");
        if (!$("#context-mode-toggle").is(":checked")) {
          $("#context-mode-toggle").prop("checked", true).trigger("change");
        }
      }
    },
  );

  // ... (All other existing listeners from the previous file version go here) ...
  // Duplicating them for completeness.

  $("#form-add-text-snippet").on("submit", function (e) {
    e.preventDefault();
    const content = $("#text-snippet-content").val().trim();
    const customId = $("#text-snippet-id").val().trim() || null;
    if (!content || !window.currentLlmSessionId) {
      showToast("Error", "Content and active session are required.", "danger");
      return;
    }
    $.ajax({
      url: `/api/sessions/${window.currentLlmSessionId}/workspace/add_text`,
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify({ content: content, item_id: customId }),
      dataType: "json",
      success: function (response) {
        showToast(
          "Success",
          `Text snippet added as item: ${escapeHtml(response.id)}`,
          "success",
        );
        $("#form-add-text-snippet")[0].reset();
        fetchAndDisplayWorkspaceItems();
        updateFullContextPreview(); // Trigger update on change
      },
      error: function (jqXHR) {
        const errorMsg =
          jqXHR.responseJSON?.error || "Failed to add text snippet.";
        showToast("Error", errorMsg, "danger");
      },
    });
  });

  $("#form-add-file-by-path").on("submit", function (e) {
    e.preventDefault();
    const filePath = $("#file-path-input").val().trim();
    const customId = $("#file-item-id").val().trim() || null;
    if (!filePath || !window.currentLlmSessionId) {
      showToast(
        "Error",
        "File path and active session are required.",
        "danger",
      );
      return;
    }
    $.ajax({
      url: `/api/sessions/${window.currentLlmSessionId}/workspace/add_file`,
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify({ file_path: filePath, item_id: customId }),
      dataType: "json",
      success: function (response) {
        showToast(
          "Success",
          `File added as item: ${escapeHtml(response.id)}`,
          "success",
        );
        $("#form-add-file-by-path")[0].reset();
        fetchAndDisplayWorkspaceItems();
        updateFullContextPreview(); // Trigger update on change
      },
      error: function (jqXHR) {
        const errorMsg =
          jqXHR.responseJSON?.error || "Failed to add file by path.";
        showToast("Error", errorMsg, "danger");
      },
    });
  });

  $("#workspace-items-list").on(
    "click",
    ".btn-view-workspace-item",
    function () {
      const itemId = $(this).closest(".workspace-item").data("item-id");
      if (!itemId || !window.currentLlmSessionId) return;
      $.ajax({
        url: `/api/sessions/${window.currentLlmSessionId}/workspace/items/${itemId}`,
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
      if (!itemId || !window.currentLlmSessionId) return;
      showToast(
        "Confirm",
        `Remove workspace item ${itemId}?`,
        "warning",
        true,
        function (confirmed) {
          if (confirmed) {
            $.ajax({
              url: `/api/sessions/${window.currentLlmSessionId}/workspace/items/${itemId}`,
              type: "DELETE",
              dataType: "json",
              success: function (response) {
                showToast(
                  "Success",
                  response.message || "Item removed.",
                  "success",
                );
                fetchAndDisplayWorkspaceItems();
                window.stagedContextItems = window.stagedContextItems.filter(
                  (si) =>
                    !(si.type === "workspace_item" && si.id_ref === itemId),
                );
                renderStagedContextItems();
                updateFullContextPreview(); // Trigger update on change
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

  $(
    "#btn-stage-from-workspace, #btn-stage-from-history, #btn-stage-new-file, #btn-stage-new-text",
  ).on("click", function () {
    // This is simplified for brevity. A real implementation might open modals to select items.
    const actionId = $(this).attr("id");
    if (actionId === "btn-stage-new-file") {
      const filePath = prompt("Enter server path to file to stage:");
      if (filePath && filePath.trim() !== "") {
        addStagedContextItem("file_content", null, null, filePath.trim());
        showToast(
          "Staged",
          `File ${filePath} added to active context.`,
          "info",
        );
      }
    } else if (actionId === "btn-stage-new-text") {
      const textContent = prompt("Enter text content to stage:");
      if (textContent && textContent.trim() !== "") {
        addStagedContextItem("text_content", null, textContent.trim(), null);
        showToast("Staged", `Text snippet added to active context.`, "info");
      }
    } else {
      showToast(
        "Info",
        "This staging method is not fully implemented yet.",
        "info",
      );
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
      const item = window.stagedContextItems.find(
        (i) => i.spec_item_id === specItemId,
      );
      if (item && item.type === "text_content") {
        const newContent = prompt("Edit staged text content:", item.content);
        if (newContent !== null) {
          item.content = newContent;
          renderStagedContextItems();
          updateFullContextPreview(); // Trigger update on change
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
    if (!window.currentLlmSessionId) {
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
      url: `/api/sessions/${window.currentLlmSessionId}/context/preview`,
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify({
        current_query: userQueryForPreview,
        staged_items: window.stagedContextItems,
      }),
      dataType: "json",
      success: function (data) {
        renderContextPreviewModal(data);
      },
      error: function (jqXHR) {
        $("#modalContextPreviewDisplay").html(
          `<p class="text-danger">Error generating preview: ${escapeHtml(jqXHR.responseJSON?.error || "Unknown error")}</p>`,
        );
      },
    });
  });

  // Listen to changes on history selection checkboxes
  $("#history-context-message-list").on(
    "change",
    ".form-check-input",
    function () {
      updateFullContextPreview();
    },
  );

  $("#history-context-select-all").on("click", function () {
    $("#history-context-message-list .form-check-input").prop("checked", true);
    updateFullContextPreview();
  });

  $("#history-context-deselect-all").on("click", function () {
    $("#history-context-message-list .form-check-input").prop("checked", false);
    updateFullContextPreview();
  });

  $("#history-context-invert").on("click", function () {
    $("#history-context-message-list .form-check-input").each(function () {
      $(this).prop("checked", !$(this).prop("checked"));
    });
    updateFullContextPreview();
  });

  $("#btn-save-context-selection").on("click", function () {
    if (!window.currentLlmSessionId) {
      showToast("Error", "No active session to save context for.", "danger");
      return;
    }
    const messageInclusionMap = {};
    $("#history-context-message-list .form-check-input").each(function () {
      const messageId = $(this).data("message-id");
      const isIncluded = $(this).is(":checked");
      messageInclusionMap[messageId] = isIncluded;
    });

    console.log(
      "CTX_MAN_UI: Saving message inclusion map:",
      messageInclusionMap,
    );

    $.ajax({
      url: `/api/sessions/${window.currentLlmSessionId}/metadata`,
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify({
        client_data: {
          message_inclusion_map: messageInclusionMap,
        },
      }),
      dataType: "json",
      success: function (response) {
        showToast(
          "Success",
          "History context selection saved successfully.",
          "success",
        );
        console.log("CTX_MAN_UI: Save context selection response:", response);
      },
      error: function (jqXHR) {
        const errorMsg =
          jqXHR.responseJSON?.error || "Failed to save context selection.";
        showToast("Error", errorMsg, "danger");
        console.error(
          "CTX_MAN_UI: Error saving context selection:",
          jqXHR.responseText,
        );
      },
    });
  });

  console.log("Context Manager UI event listeners initialized.");
}
