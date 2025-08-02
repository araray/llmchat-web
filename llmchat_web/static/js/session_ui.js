// llmchat_web/static/js/session_ui.js

/**
 * @file session_ui.js
 * @description Manages all UI interactions for the session list in the left sidebar,
 * including rendering and handling create, load, rename, and delete actions.
 * It uses session_api.js for backend communication.
 */

/**
 * Renders a list of session objects into the session list UI.
 * @param {Array<Object>} sessions - An array of session metadata objects.
 * @param {string|null} activeSessionId - The ID of the session to mark as active.
 */
function renderSessionList(sessions, activeSessionId) {
  const $sessionList = $("#session-list").empty();
  if (sessions && sessions.length > 0) {
    sessions.forEach(function (session) {
      const buttonsHtml = `
        <div class="btn-group" role="group">
          <button class="btn btn-sm btn-outline-secondary btn-rename-session-item" data-session-id="${escapeHtml(session.id)}" title="Rename Session">
            <i class="fas fa-pencil-alt fa-xs"></i>
          </button>
          <button class="btn btn-sm btn-outline-danger btn-delete-session-item" data-session-id="${escapeHtml(session.id)}" title="Delete Session">
            <i class="fas fa-trash-alt fa-xs"></i>
          </button>
        </div>`;

      const $sessionItem = $("<a>", {
        href: "#",
        class:
          "list-group-item list-group-item-action d-flex justify-content-between align-items-center",
        "data-session-id": session.id,
        html: `<div>
                 <div class="fw-bold session-name-display">${escapeHtml(session.name) || escapeHtml(session.id.substring(0, 15)) + "..."}</div>
                 <small class="text-muted">Messages: ${session.message_count || 0}</small>
               </div>
               ${buttonsHtml}`,
      });

      if (session.id === activeSessionId) {
        $sessionItem.addClass("active");
      }
      $sessionList.append($sessionItem);
    });
  } else {
    $sessionList.append(
      '<p class="text-muted small m-2">No saved sessions found.</p>',
    );
  }
}

/**
 * Fetches the list of saved sessions from the backend and renders them.
 */
function fetchAndDisplaySessions() {
  apiFetchSessions()
    .done(function (sessions) {
      renderSessionList(sessions, window.currentLlmSessionId);
    })
    .fail(function () {
      $("#session-list").html(
        '<p class="text-danger small m-2">Error loading sessions.</p>',
      );
    });
}

/**
 * Initializes all event listeners for the session management UI.
 */
function initSessionUIEventListeners() {
  const $sessionList = $("#session-list");

  // New Session Button
  $("#btn-new-session").on("click", function () {
    apiCreateNewSession()
      .done(function (newSessionResponse) {
        window.currentLlmSessionId = newSessionResponse.id;
        $("#chat-messages")
          .empty()
          .append(
            '<div class="message-bubble agent-message">New session started.</div>',
          );
        updateChatPanelState(true);

        // Reset relevant global state and UI components
        window.stagedContextItems = [];
        if (typeof renderStagedContextItems === "function")
          renderStagedContextItems(new Set());
        window.lastBaseContextUsage = null;
        updateContextUsageDisplay(null);
        fetchAndUpdateInitialStatus(); // A full refresh ensures all settings are reset to default
      })
      .fail(function () {
        showToast("Error", "Failed to create new session.", "danger");
      });
  });

  // Load Session from List
  $sessionList.on("click", "a.list-group-item", function (e) {
    e.preventDefault();
    const sessionIdToLoad = $(this).data("session-id");
    if (sessionIdToLoad === window.currentLlmSessionId) return;

    apiLoadSession(sessionIdToLoad)
      .done(function (response) {
        // The main controller will handle the complex state update
        fetchAndUpdateInitialStatus();
        // Manually re-render chat history as fetchAndUpdate might not be fast enough
        const $chatPanel = $("#chat-messages").empty();
        if (
          response.session_data &&
          response.session_data.messages &&
          response.session_data.messages.length > 0
        ) {
          response.session_data.messages.forEach((msg) => {
            appendMessageToChat(msg.content, msg.role, false, msg.id);
          });
        } else {
          $chatPanel.append(
            '<p class="text-muted text-center small p-3">This session is empty.</p>',
          );
        }
      })
      .fail(function () {
        showToast("Error", "Failed to load session.", "danger");
      });
  });

  // Rename Session Button
  $sessionList.on("click", ".btn-rename-session-item", function (e) {
    e.preventDefault();
    e.stopPropagation();
    const sessionIdToRename = $(this).data("session-id");
    const currentName = $(this)
      .closest(".list-group-item")
      .find(".session-name-display")
      .text();
    const newName = prompt(
      "Enter the new name for the session:",
      currentName.endsWith("...") ? "" : currentName,
    );

    if (newName && newName.trim() !== "" && newName.trim() !== currentName) {
      apiRenameSession(sessionIdToRename, newName.trim())
        .done(function () {
          showToast("Success", "Session renamed successfully.", "success");
          fetchAndDisplaySessions();
        })
        .fail(function (jqXHR) {
          showToast(
            "Error",
            jqXHR.responseJSON?.error || "Failed to rename session.",
            "danger",
          );
        });
    }
  });

  // Delete Session Button
  $sessionList.on("click", ".btn-delete-session-item", function (e) {
    e.preventDefault();
    e.stopPropagation();
    const sessionIdToDelete = $(this).data("session-id");
    showToast(
      "Confirm",
      `Delete session ${sessionIdToDelete}?`,
      "warning",
      true,
      function (confirmed) {
        if (confirmed) {
          apiDeleteSession(sessionIdToDelete).done(function () {
            showToast("Success", "Session deleted.", "success");
            if (window.currentLlmSessionId === sessionIdToDelete) {
              window.currentLlmSessionId = null;
              // A full refresh is the cleanest way to reset the entire UI to a no-session state
              fetchAndUpdateInitialStatus();
            } else {
              fetchAndDisplaySessions();
            }
          });
        }
      },
    );
  });

  console.log("SESSION_UI: Event listeners initialized.");
}
