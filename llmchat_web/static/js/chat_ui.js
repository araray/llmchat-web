// llmchat_web/static/js/chat_ui.js

/**
 * @file chat_ui.js
 * @description Handles chat message UI, sending messages, SSE, per-message actions, and raw output display.
 * Depends on utils.js for helper functions (escapeHtml, showToast) and
 * accesses global variables/functions from custom.js (currentLlmSessionId, stagedContextItems,
 * updateContextUsageDisplay, fetchAndDisplayWorkspaceItems).
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
  const $messageDiv = $("<div>", {
    id: messageId,
    class: `message-bubble ${sender === "user" ? "user-message" : "agent-message"} ${isError ? "error-message-bubble" : ""}`,
    // text content is safer than html if text might contain HTML-like strings by mistake
    text: text, // Using .text() to prevent accidental HTML injection from message content itself
  });

  if (persistentMessageId) {
    $messageDiv.attr("data-message-id", persistentMessageId);
    const actionsHtml = `
          <div class="message-actions mt-1">
              <button class="btn btn-sm btn-outline-light btn-copy-message" title="Copy"><i class="fas fa-copy fa-xs"></i></button>
              <button class="btn btn-sm btn-outline-light btn-add-workspace" title="Add to Workspace"><i class="fas fa-plus-square fa-xs"></i></button>
              <button class="btn btn-sm btn-outline-light btn-delete-message" title="Delete Message"><i class="fas fa-trash fa-xs"></i></button>
          </div>`;
    $messageDiv.append(actionsHtml); // Actions are trusted HTML
  }

  $chatMessages.prepend($messageDiv);
  return messageId;
}

/**
 * Appends content to the Raw LLM Output display.
 * Prepends new responses with a timestamp and separator.
 * @param {string} content - The raw content to append.
 * @param {boolean} isNewResponseSegment - True if this is the start of a new LLM response, false if it's a continuing chunk.
 */
function appendRawOutput(content, isNewResponseSegment) {
  const $rawOutputDisplay = $("#raw-llm-output-display");
  let currentRawContent = $rawOutputDisplay.text();

  if (isNewResponseSegment) {
    const timestamp = new Date().toLocaleTimeString();
    const separator = `\n\n--- Raw Output at ${timestamp} ---\n`;
    // Prepend new response to existing content
    $rawOutputDisplay.text(separator + content + currentRawContent);
  } else {
    // For streaming chunks, we need to append to the *current* response block.
    // This means finding the last separator and appending after it, or to the start if no separator yet.
    const lastSeparatorIndex = currentRawContent.indexOf("--- Raw Output at");
    if (isNewResponseSegment && lastSeparatorIndex !== -1) {
      // Should be caught by isNewResponseSegment logic above
      // This case should not happen if isNewResponseSegment logic is correct.
      // Defensive: prepend if somehow isNewResponseSegment is true but we're in a stream.
      $rawOutputDisplay.text(content + currentRawContent);
    } else if (lastSeparatorIndex !== -1) {
      // Append to the latest block
      const beforeLastBlock = currentRawContent.substring(
        0,
        lastSeparatorIndex,
      );
      let lastBlockContent = currentRawContent.substring(lastSeparatorIndex);
      // Find the end of the "--- Raw Output at TIMESTAMP ---" line to append after it
      const endOfSeparatorLine = lastBlockContent.indexOf("\n") + 1;
      lastBlockContent =
        lastBlockContent.substring(0, endOfSeparatorLine) +
        content +
        lastBlockContent.substring(endOfSeparatorLine);
      $rawOutputDisplay.text(beforeLastBlock + lastBlockContent);
    } else {
      // No separator yet, just prepend (or append if it's the very first chunk of the very first message)
      // To ensure chunks append correctly for the *first* message before a separator is added:
      if ($rawOutputDisplay.data("is-streaming-first-response")) {
        $rawOutputDisplay.text(currentRawContent + content);
      } else {
        // This case is for the very first chunk of a new response if the display was empty.
        // It will be caught by isNewResponseSegment=true on the next call.
        // For now, just set it.
        $rawOutputDisplay.text(content + currentRawContent); // Prepend if no stream state
      }
    }
  }
}

/**
 * Sends the chat message to the backend and handles streaming response.
 * Accesses global currentLlmSessionId and stagedContextItems.
 * Calls global updateContextUsageDisplay.
 * Updates Raw Output tab.
 */
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

  // Indicate start of a new response for raw output
  // For the very first response, we might not have a separator yet.
  if ($("#raw-llm-output-display").text().length === 0) {
    $("#raw-llm-output-display").data("is-streaming-first-response", true);
  } else {
    $("#raw-llm-output-display").data("is-streaming-first-response", false);
  }
  // The first actual chunk/response will call appendRawOutput with isNewResponseSegment = true
  let rawOutputIsNewResponseSegment = true;

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
      const errorMessage = errorData.error || response.statusText;
      $(`#${agentMessageElementId}`).html(
        `<span class="text-danger">Error: ${escapeHtml(errorMessage)}</span>`,
      );
      appendRawOutput(`Error: ${errorMessage}`, rawOutputIsNewResponseSegment);
      rawOutputIsNewResponseSegment = false; // Subsequent raw output for this error is part of the same "response"
      updateContextUsageDisplay(null);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let accumulatedContent = ""; // For chat display
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
              // Update chat display with HTML escaped content
              $(`#${agentMessageElementId}`).html(
                escapeHtml(accumulatedContent),
              );
              // Append raw content to raw output display
              appendRawOutput(eventData.content, rawOutputIsNewResponseSegment);
              rawOutputIsNewResponseSegment = false; // Subsequent chunks are part of the same response
              $("#raw-llm-output-display").data(
                "is-streaming-first-response",
                false,
              ); // No longer the first overall response
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
              $("#raw-llm-output-display").data(
                "is-streaming-first-response",
                false,
              );
              return;
            } else if (eventData.type === "error") {
              console.error("SSE Error Event:", eventData.error);
              const sseErrorMessage = eventData.error;
              $(`#${agentMessageElementId}`).html(
                `<span class="text-danger">Stream Error: ${escapeHtml(sseErrorMessage)}</span>`,
              );
              appendRawOutput(
                `Stream Error: ${sseErrorMessage}`,
                rawOutputIsNewResponseSegment,
              );
              rawOutputIsNewResponseSegment = false;
              $("#raw-llm-output-display").data(
                "is-streaming-first-response",
                false,
              );
              return;
            }
          } catch (e) {
            console.warn("Error parsing SSE event data:", e, "Line:", line);
          }
        }
      }
    }
    // Final update of chat content and actions if not already done by 'end' or 'full_response_id'
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
    $("#raw-llm-output-display").data("is-streaming-first-response", false);
  } catch (error) {
    console.error("Error sending message:", error);
    const catchErrorMessage =
      error.message || "Could not connect to chat service.";
    $(`#${agentMessageElementId}`).html(
      `<span class="text-danger">Error: ${escapeHtml(catchErrorMessage)}</span>`,
    );
    appendRawOutput(
      `Error: ${catchErrorMessage}`,
      rawOutputIsNewResponseSegment,
    );
    // rawOutputIsNewResponseSegment = false; // Not strictly needed here as we return
    updateContextUsageDisplay(null);
    $("#raw-llm-output-display").data("is-streaming-first-response", false);
  }
}

/**
 * Initializes event listeners related to chat messages.
 */
function initChatEventListeners() {
  $("#send-chat-message").on("click", function () {
    sendMessage();
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
      .clone()
      .children(".message-actions")
      .remove()
      .end()
      .text() // Use .text() to get the pure text content
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
        if (
          typeof fetchAndDisplayWorkspaceItems === "function" &&
          $("#context-manager-tab-btn").hasClass("active")
        ) {
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
  console.log("Chat UI event listeners initialized.");
}
