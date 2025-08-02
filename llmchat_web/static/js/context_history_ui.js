// llmchat_web/static/js/context_history_ui.js

/**
 * @file context_history_ui.js
 * @description Handles UI logic for the History Context sub-tab, allowing users
 * to select which messages from the conversation history are included in the context.
 * Depends on utils.js, session_api.js, and accesses/modifies global state.
 */

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
      "data-message-content": msg.content,
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
    const $toWorkbenchBtn = $("<button>", {
      class: "btn btn-sm btn-outline-secondary ms-2 btn-add-to-workbench",
      title: "Add message content to Prompt Workbench",
      html: '<i class="fas fa-file-import fa-xs"></i>',
    });
    $itemDiv.append($checkbox, $label, $toWorkbenchBtn);
    $list.append($itemDiv);
  });
  console.log("CTX_HISTORY_UI: History context list rendered.");
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
    `CTX_HISTORY_UI: Fetching full session for history context: ${window.currentLlmSessionId}`,
  );
  apiLoadSession(window.currentLlmSessionId)
    .done(function (response) {
      if (response && response.session_data) {
        const session = response.session_data;
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
        "CTX_HISTORY_UI: Error fetching session for history context:",
        jqXHR.responseJSON,
      );
      $("#history-context-message-list").html(
        '<p class="text-danger p-2">Error loading session data.</p>',
      );
    });
}

/**
 * Initializes event listeners for the History Context UI.
 */
function initHistoryEventListeners() {
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
      "CTX_HISTORY_UI: Saving message inclusion map:",
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
        console.log(
          "CTX_HISTORY_UI: Save context selection response:",
          response,
        );
      },
      error: function (jqXHR) {
        const errorMsg =
          jqXHR.responseJSON?.error || "Failed to save context selection.";
        showToast("Error", errorMsg, "danger");
        console.error(
          "CTX_HISTORY_UI: Error saving context selection:",
          jqXHR.responseText,
        );
      },
    });
  });

  console.log("Context History UI event listeners initialized.");
}
