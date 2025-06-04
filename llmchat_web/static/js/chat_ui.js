// llmchat_web/static/js/chat_ui.js

/**
 * @file chat_ui.js
 * @description Handles chat message UI, sending messages, SSE, and per-message actions.
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
    html: escapeHtml(text), // Ensure text is escaped
  });

  if (persistentMessageId) {
    $messageDiv.attr("data-message-id", persistentMessageId);
    // Actions are added dynamically after stream for agent messages, or directly for loaded user messages.
    // For consistency, actions for existing messages (loaded from history) should also be added here.
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

/**
 * Sends the chat message to the backend and handles streaming response.
 * Accesses global currentLlmSessionId and stagedContextItems.
 * Calls global updateContextUsageDisplay.
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

  appendMessageToChat(messageText, "user"); // User message doesn't get actions immediately this way, but matches existing logic.
  // If actions are desired for user messages, persistentMessageId needs to be handled.
  $("#chat-input").val("");
  updateChatInputTokenEstimate(); // Assumes this function is globally available from custom.js

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
        active_context_specification: stagedContextItems, // Uses global stagedContextItems
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
      updateContextUsageDisplay(null); // Assumes this function is globally available
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
              updateContextUsageDisplay(eventData.data); // Assumes global
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
    // This part might be redundant if the 'end' event always fires and handles it.
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
    updateContextUsageDisplay(null); // Assumes global
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
          fetchAndDisplayWorkspaceItems(); // Assumes global
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
