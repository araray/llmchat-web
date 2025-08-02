// llmchat_web/static/js/context_preview_ui.js

/**
 * @file context_preview_ui.js
 * @description Handles UI logic for the full context preview, including fetching,
 * parsing, and rendering the preview modal, and driving the global token count.
 * Depends on utils.js and accesses/modifies global state from main_controller.js.
 */

// Debounce timer to avoid excessive API calls for full context preview.
let fullContextPreviewDebounceTimer;

/**
 * **FIX**: Extracts the IDs of all context items that were actually included in the final prompt.
 * It parses the special system messages that LLMCore uses to wrap context items.
 * This is crucial for determining which staged items were dropped due to token limits.
 * @param {Array<Object>} preparedMessages - The `prepared_messages` array from the context preview API response.
 * @returns {Set<string>} A Set containing the IDs of all included workspace and history message items.
 */
function getIncludedItemIdsFromPreview(preparedMessages) {
  const includedIds = new Set();
  if (!preparedMessages) {
    return includedIds;
  }

  // Regex to find "Staged Context Item (ID: ...)" or similar markers.
  // This needs to be robust to match what LLMCore actually produces.
  const idPattern = /--- Staged Context Item \(ID: ([\w-]+)/;
  const historyIdPattern = /--- Message from History \(ID: ([\w-]+)/;

  preparedMessages.forEach((msg) => {
    if (msg.role === "system" && msg.content) {
      let match = msg.content.match(idPattern);
      if (match && match[1]) {
        includedIds.add(match[1]);
      }
      match = msg.content.match(historyIdPattern);
      if (match && match[1]) {
        includedIds.add(match[1]);
      }
    }
  });
  console.log(
    "CTX_PREVIEW_UI: Identified included context item IDs from preview:",
    includedIds,
  );
  return includedIds;
}

/**
 * **MODIFIED**: Fetches a full context preview from the backend to get an accurate token count
 * and determine which staged items were actually included.
 * This function is debounced to avoid excessive API calls. It is now the
 * primary driver for updating both the token counter and the visual state of staged items.
 */
function updateFullContextPreview() {
  clearTimeout(fullContextPreviewDebounceTimer);
  fullContextPreviewDebounceTimer = setTimeout(async () => {
    if (!window.currentLlmSessionId) {
      return;
    }

    const isUIManaged = $("#context-mode-toggle").is(":checked");
    if (isUIManaged) {
      updatePromptWorkbenchTokenEstimate(); // In UI mode, only update the workbench counter
      return;
    }

    const payload = {
      current_query: $("#chat-input").val() || "",
      staged_items: window.stagedContextItems || [],
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
        const errData = await response.json().catch(() => ({}));
        console.warn(
          "CTX_PREVIEW_UI: Failed to fetch full context preview for token count:",
          errData.error || "API error",
        );
        // On error, re-render staged items in their default state without truncation info
        renderStagedContextItems(new Set());
        return;
      }

      const data = await response.json();
      if (typeof updateContextUsageDisplay === "function") {
        updateContextUsageDisplay(data);
      }

      // **THE FIX**: Get the set of included IDs and re-render the staged items list
      // to visually indicate which items were included vs. dropped/truncated.
      const includedItemIds = getIncludedItemIdsFromPreview(
        data.prepared_messages,
      );
      renderStagedContextItems(includedItemIds);
    } catch (error) {
      console.warn(
        "CTX_PREVIEW_UI: Network error fetching full context preview:",
        error,
      );
    }
  }, 500); // 500ms debounce delay
}

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
    $display.append('<p class="text-muted small">No messages prepared.</p>');
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
      `<h6><i class="fas fa-code"></i> Rendered RAG Prompt:</h6>`,
    );
    $display.append(
      `<pre style="white-space: pre-wrap; word-break: break-all; font-size: 0.8em; max-height: 200px; overflow-y: auto; background-color: #333; padding: 5px; border-radius: 3px;">${escapeHtml(data.rendered_rag_template_content)}</pre>`,
    );
  }
  console.log("CTX_PREVIEW_UI: Context preview modal rendered.");
}

/**
 * Initializes event listeners for the context preview functionality.
 */
function initPreviewEventListeners() {
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

  console.log("Context Preview UI event listeners initialized.");
}
