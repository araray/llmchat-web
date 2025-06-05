// llmchat_web/static/js/chat_ui.js

/**
 * @file chat_ui.js
 * @description Handles chat message UI, sending messages, SSE, per-message actions, and raw output display.
 * Depends on utils.js for helper functions (escapeHtml, showToast) and
 * accesses global variables/functions from custom.js (currentLlmSessionId, stagedContextItems,
 * updateContextUsageDisplay, fetchAndDisplayWorkspaceItems).
 */

// Global variable to hold the jQuery object of the current raw output block
let currentRawOutputBlock = null;

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
 * Each new response or error creates a new prepended block. Streamed chunks append to the current block.
 * @param {string} content - The raw content to append.
 * @param {boolean} isNewResponseBlock - True if this is the start of a new LLM response block, false if it's a continuing chunk.
 */
function appendRawOutput(content, isNewResponseBlock) {
  const $rawOutputDisplay = $("#raw-llm-output-display");

  if (isNewResponseBlock) {
    const timestamp = new Date().toLocaleTimeString();
    const separator = `--- Raw Output at ${timestamp} ---\n`;
    // Create a new <pre> element for this block
    const $newBlock = $("<pre>").text(separator + content);
    $rawOutputDisplay.prepend($newBlock);
    currentRawOutputBlock = $newBlock; // Set as the current block for subsequent appends
  } else {
    if (currentRawOutputBlock) {
      // Append content to the existing current block
      currentRawOutputBlock.text(currentRawOutputBlock.text() + content);
    } else {
      // Fallback: If no current block, prepend as a new block (though this shouldn't happen if logic is correct)
      console.warn(
        "appendRawOutput: No currentRawOutputBlock, creating new block for chunk.",
      );
      const timestamp = new Date().toLocaleTimeString();
      const fallbackSeparator = `--- Raw Output Chunk (no current block) at ${timestamp} ---\n`;
      const $newBlock = $("<pre>").text(fallbackSeparator + content);
      $rawOutputDisplay.prepend($newBlock);
      currentRawOutputBlock = $newBlock; // Set this as current
    }
  }
  // Ensure the main raw output display scrolls to the top to show the latest prepended block
  if ($rawOutputDisplay[0]) {
    $rawOutputDisplay.scrollTop(0);
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
  if (!window.currentLlmSessionId) {
    // Use window. to be explicit about global
    showToast(
      "Error",
      "No active session. Please start or load a session.",
      "danger",
    );
    return;
  }

  // Flag to indicate the first chunk of a new response for raw output logic
  let rawOutputIsNewResponseSegment = true;
  currentRawOutputBlock = null; // Reset current raw output block for new message

  appendMessageToChat(messageText, "user");
  $("#chat-input").val("");
  if (typeof updateChatInputTokenEstimate === "function") {
    // Check if function exists
    updateChatInputTokenEstimate();
  }

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
        session_id: window.currentLlmSessionId, // Use window.
        stream: true,
        active_context_specification: window.stagedContextItems, // Use window.
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
      appendRawOutput(`Error: ${errorMessage}`, rawOutputIsNewResponseSegment); // True for new error block
      rawOutputIsNewResponseSegment = false; // Any further raw output for this error is part of the same "response"
      if (typeof updateContextUsageDisplay === "function")
        updateContextUsageDisplay(null); // Check if function exists
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
              if (typeof updateContextUsageDisplay === "function")
                updateContextUsageDisplay(eventData.data); // Check if function exists
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
              currentRawOutputBlock = null; // Clear current block on stream end
              return;
            } else if (eventData.type === "error") {
              console.error("SSE Error Event:", eventData.error);
              const sseErrorMessage = eventData.error;
              $(`#${agentMessageElementId}`).html(
                `<span class="text-danger">Stream Error: ${escapeHtml(sseErrorMessage)}</span>`,
              );
              appendRawOutput(
                `Stream Error: ${sseErrorMessage}`,
                rawOutputIsNewResponseSegment, // True for new error block
              );
              rawOutputIsNewResponseSegment = false;
              currentRawOutputBlock = null; // Clear current block on error
              return;
            }
          } catch (e) {
            console.warn("Error parsing SSE event data:", e, "Line:", line);
            // If parsing fails, log the raw line to raw output as a new block
            appendRawOutput(
              `Failed to parse SSE line: ${line}`,
              rawOutputIsNewResponseSegment,
            );
            rawOutputIsNewResponseSegment = false; // subsequent lines of this error are part of same block
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
    currentRawOutputBlock = null; // Clear current block as message is complete
  } catch (error) {
    console.error("Error sending message:", error);
    const catchErrorMessage =
      error.message || "Could not connect to chat service.";
    $(`#${agentMessageElementId}`).html(
      `<span class="text-danger">Error: ${escapeHtml(catchErrorMessage)}</span>`,
    );
    appendRawOutput(
      `Error: ${catchErrorMessage}`,
      rawOutputIsNewResponseSegment, // True for new error block
    );
    if (typeof updateContextUsageDisplay === "function")
      updateContextUsageDisplay(null); // Check if function exists
    currentRawOutputBlock = null; // Clear current block on error
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
    if (!messageId || !window.currentLlmSessionId) {
      // Use window.
      showToast(
        "Error",
        "Cannot add to workspace: Message ID or Session ID is missing.",
        "danger",
      );
      return;
    }
    console.log(
      `Adding message ${messageId} to workspace for session ${window.currentLlmSessionId}`, // Use window.
    );
    $.ajax({
      url: `/api/sessions/${window.currentLlmSessionId}/workspace/add_from_message`, // Use window.
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
    if (!messageId || !window.currentLlmSessionId) {
      // Use window.
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
            `Deleting message ${messageId} from session ${window.currentLlmSessionId}`, // Use window.
          );
          $.ajax({
            url: `/api/sessions/${window.currentLlmSessionId}/messages/${messageId}`, // Use window.
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
