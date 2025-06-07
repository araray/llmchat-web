// llmchat_web/static/js/chat_ui.js

/**
 * @file chat_ui.js
 * @description Handles chat message UI, sending messages, SSE, and per-message actions.
 * Now also handles the 'rag_results' SSE event, sending data from the
 * "UI Managed" Prompt Workbench mode, and adding action buttons to user messages.
 * This version includes fixes for preserving action buttons during streaming and
 * triggers real-time token estimation on input for both the chat input and the
 * full context preview.
 * Depends on utils.js, rag_ui.js, session_api.js and accesses global state from main_controller.js.
 */

/**
 * Appends a message to the chat UI.
 * @param {string} text - The message content.
 * @param {string} sender - 'user' or 'agent'.
 * @param {boolean} [isError=false] - If true, styles as an error message.
 * @param {string|null} [persistentMessageId=null] - The persistent ID of the message from the backend.
 * @param {string|null} [elementIdOverride=null] - Specific ID to use for the message element.
 * @returns {string} The ID of the appended message element.
 */
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

  // Use a content span to separate text from actions
  const $contentSpan = $("<span>").text(text);
  const $messageDiv = $("<div>", {
    id: messageId,
    class: `message-bubble ${sender === "user" ? "user-message" : "agent-message"} ${isError ? "error-message-bubble" : ""}`,
  }).append($contentSpan);

  if (!isError) {
    const actionsHtml = `
          <div class="message-actions mt-1">
              <button class="btn btn-sm btn-outline-light btn-copy-message" title="Copy"><i class="fas fa-copy fa-xs"></i></button>
              <button class="btn btn-sm btn-outline-light btn-add-workspace" title="Add to Workspace"><i class="fas fa-plus-square fa-xs"></i></button>
              <button class="btn btn-sm btn-outline-light btn-delete-message" title="Delete Message"><i class="fas fa-trash fa-xs"></i></button>
          </div>`;
    $messageDiv.append(actionsHtml);
  }

  if (persistentMessageId) {
    $messageDiv.attr("data-message-id", persistentMessageId);
  }

  $chatMessages.prepend($messageDiv);
  return messageId;
}

/**
 * Sends the chat message to the backend and handles streaming response.
 * It now checks for the context management mode ('LLMCore' vs 'UI') and constructs
 * the payload accordingly. After completion, it fetches the user message's persistent ID.
 * Accesses global variables: currentLlmSessionId, stagedContextItems.
 * Calls global functions: updateContextUsageDisplay, displayRetrievedDocuments, apiLoadSession.
 */
async function sendMessage() {
  const messageText = $("#chat-input").val().trim();
  if (!messageText) return;
  if (!window.currentLlmSessionId) {
    showToast(
      "Error",
      "No active session. Please start or load a session.",
      "danger",
    );
    return;
  }

  const userMessageElementId = appendMessageToChat(messageText, "user");

  $("#chat-input").val("");
  // After clearing the input, reset the token estimate display and full context preview.
  if (typeof updateChatInputTokenEstimate === "function") {
    updateChatInputTokenEstimate();
  }
  if (typeof updateFullContextPreview === "function") {
    updateFullContextPreview();
  }

  const agentMessageElementId = `agent-msg-${Date.now()}`;
  appendMessageToChat(
    "Thinking...",
    "agent",
    false,
    null,
    agentMessageElementId,
  );
  // Get a reference to the content span within the agent message bubble
  const $agentContentSpan = $(`#${agentMessageElementId}`).find("span").first();

  if (typeof displayRetrievedDocuments === "function") {
    displayRetrievedDocuments([]);
  }

  const isUIManaged = $("#context-mode-toggle").is(":checked");
  const payload = {
    message: messageText,
    session_id: window.currentLlmSessionId,
    stream: true,
  };

  if (isUIManaged) {
    console.log("CHAT_UI: Sending message in UI Managed mode.");
    payload.raw_prompt_workbench_content = $(
      "#prompt-workbench-textarea",
    ).val();
  } else {
    console.log("CHAT_UI: Sending message in LLMCore Managed mode.");
    const messageInclusionMap = {};
    let mapIsRelevant = false;
    $("#history-context-message-list .form-check-input").each(function () {
      const messageId = $(this).data("message-id");
      const isIncluded = $(this).is(":checked");
      if (messageId) {
        messageInclusionMap[messageId] = isIncluded;
        mapIsRelevant = true;
      }
    });
    payload.active_context_specification = window.stagedContextItems;
    payload.message_inclusion_map = mapIsRelevant ? messageInclusionMap : null;
  }

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ error: "Unknown server error" }));
      $agentContentSpan.html(
        `<span class="text-danger">Error: ${escapeHtml(errorData.error || response.statusText)}</span>`,
      );
      if (typeof updateContextUsageDisplay === "function")
        updateContextUsageDisplay(null, 0);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let accumulatedContent = "";
    let persistentMsgId = null;

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
              $agentContentSpan.text(accumulatedContent); // Use .text() to update only the content span
            } else if (
              eventData.type === "full_response_id" &&
              eventData.message_id
            ) {
              persistentMsgId = eventData.message_id;
              $(`#${agentMessageElementId}`).attr(
                "data-message-id",
                persistentMsgId,
              );
            } else if (eventData.type === "context_usage" && eventData.data) {
              // Store the authoritative context usage from the last turn.
              window.lastBaseContextUsage = eventData.data;
              // Now, update the display. Since the prompt box is now empty, promptTokens is 0.
              if (typeof updateContextUsageDisplay === "function") {
                updateContextUsageDisplay(window.lastBaseContextUsage, 0);
              }
            } else if (eventData.type === "rag_results") {
              if (typeof displayRetrievedDocuments === "function") {
                displayRetrievedDocuments(eventData.documents || []);
              }
            } else if (eventData.type === "end") {
              if (window.currentLlmSessionId) {
                apiLoadSession(window.currentLlmSessionId).done(
                  function (response) {
                    if (
                      response &&
                      response.session_data &&
                      response.session_data.messages
                    ) {
                      const messages = response.session_data.messages;
                      for (let i = messages.length - 1; i >= 0; i--) {
                        if (messages[i].role === "user") {
                          $(`#${userMessageElementId}`).attr(
                            "data-message-id",
                            messages[i].id,
                          );
                          break;
                        }
                      }
                    }
                  },
                );
              }
              return;
            } else if (eventData.type === "error") {
              $agentContentSpan.html(
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
  } catch (error) {
    $agentContentSpan.html(
      `<span class="text-danger">Error: ${escapeHtml(error.message || "Could not connect to chat service.")}</span>`,
    );
    if (typeof updateContextUsageDisplay === "function")
      updateContextUsageDisplay(null, 0);
  }
}

/**
 * Initializes event listeners related to chat messages. This now includes
 * an 'input' event listener to trigger real-time token estimation for both
 * the local input and the full context preview.
 */
function initChatEventListeners() {
  $("#send-chat-message").on("click", function () {
    sendMessage();
  });

  // Add listener for the 'input' event to provide real-time feedback as the user types.
  $("#chat-input").on("input", function () {
    if (typeof updateChatInputTokenEstimate === "function") {
      updateChatInputTokenEstimate();
    }
    // Also trigger the full context preview, as the user's query is part of the context
    if (typeof updateFullContextPreview === "function") {
      updateFullContextPreview();
    }
  });

  $("#chat-input").on("keypress", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // --- Per-Message Action Handlers ---
  $("#chat-messages").on("click", ".btn-copy-message", function () {
    const messageContent = $(this)
      .closest(".message-bubble")
      .find("span")
      .first()
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
    if (!messageId || !window.currentLlmSessionId) {
      showToast(
        "Error",
        "Cannot add to workspace: Message ID or Session ID is missing.",
        "danger",
      );
      return;
    }
    $.ajax({
      url: `/api/sessions/${window.currentLlmSessionId}/workspace/add_from_message`,
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify({ message_id: messageId }),
      dataType: "json",
      success: function (response) {
        showToast(
          "Success",
          `Message added to workspace as item: ${escapeHtml(response.id)}`,
          "success",
        );
        if (
          typeof fetchAndDisplayWorkspaceItems === "function" &&
          $("#context-manager-tab-btn").hasClass("active") &&
          $("#workspace-subtab-btn").hasClass("active")
        ) {
          fetchAndDisplayWorkspaceItems();
        }
      },
      error: function (jqXHR) {
        const errorMsg =
          jqXHR.responseJSON?.error || "Failed to add message to workspace.";
        showToast("Error", errorMsg, "danger");
      },
    });
  });

  $("#chat-messages").on("click", ".btn-delete-message", function () {
    const $messageBubble = $(this).closest(".message-bubble");
    const messageId = $messageBubble.data("message-id");
    if (!messageId || !window.currentLlmSessionId) {
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
          $.ajax({
            url: `/api/sessions/${window.currentLlmSessionId}/messages/${messageId}`,
            type: "DELETE",
            dataType: "json",
            success: function (response) {
              showToast(
                "Success",
                response.message || "Message deleted successfully.",
                "success",
              );
              $messageBubble.fadeOut(function () {
                $(this).remove();
              });
            },
            error: function (jqXHR) {
              const errorMsg =
                jqXHR.responseJSON?.error || "Failed to delete message.";
              showToast("Error", errorMsg, "danger");
            },
          });
        }
      },
    );
  });
  console.log("Chat UI event listeners initialized.");
}
