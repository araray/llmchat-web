// llmchat_web/static/js/context_workbench_ui.js

/**
 * @file context_workbench_ui.js
 * @description Handles UI logic for the "UI Managed" Prompt Workbench mode,
 * including the mode switcher toggle and token estimation for the workbench.
 * Depends on utils.js and accesses/modifies global state from main_controller.js.
 */

/**
 * Toggles the visibility of UI sections based on the selected context management mode.
 */
function switchContextManagerMode() {
  const isUIManaged = $("#context-mode-toggle").is(":checked");
  console.log(
    `CTX_WORKBENCH_UI: Switching context mode. UI Managed: ${isUIManaged}`,
  );

  if (isUIManaged) {
    $("#llmcore-managed-context-ui").hide();
    $("#ui-managed-context-ui").show();
    updatePromptWorkbenchTokenEstimate(); // Initial token count
  } else {
    $("#ui-managed-context-ui").hide();
    $("#llmcore-managed-context-ui").show();
    if ($("#workspace-subtab-btn").hasClass("active")) {
      fetchAndDisplayWorkspaceItems();
      renderStagedContextItems(new Set());
    } else if ($("#history-subtab-btn").hasClass("active")) {
      fetchAndDisplayHistoryContext();
    }
    updateFullContextPreview();
  }
}

/**
 * Estimates the token count for the content in the Prompt Workbench.
 * This is now also called when switching to UI Managed mode.
 */
function updatePromptWorkbenchTokenEstimate() {
  clearTimeout(tokenEstimateDebounceTimer);
  tokenEstimateDebounceTimer = setTimeout(async () => {
    const text = $("#prompt-workbench-textarea").val();
    const $tokenDisplay = $("#prompt-workbench-token-count");

    if (!text) {
      $tokenDisplay.text("Tokens: 0");
      updateContextUsageDisplay({ final_token_count: 0 }); // Update top bar too
      return;
    }

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
          text,
          provider_name: providerName,
          model_name: modelName,
        }),
      });

      if (!response.ok) throw new Error("API error");

      const data = await response.json();
      const tokenCount = data.token_count || 0;
      $tokenDisplay.text(`Tokens: ~${tokenCount}`);
      updateContextUsageDisplay({ final_token_count: tokenCount }); // Update top bar
    } catch (error) {
      console.error(
        "CTX_WORKBENCH_UI: Error estimating prompt workbench tokens:",
        error,
      );
      $tokenDisplay.text("Tokens: Error");
    }
  }, 300);
}

/**
 * Initializes event listeners for the Prompt Workbench and mode switcher.
 */
function initWorkbenchEventListeners() {
  // Mode Toggle
  $("#context-mode-toggle").on("change", switchContextManagerMode);

  // Prompt Workbench Listeners
  $("#prompt-workbench-textarea").on(
    "input",
    updatePromptWorkbenchTokenEstimate,
  );

  $("#btn-populate-workbench-from-context").on("click", function () {
    if (!window.currentLlmSessionId) {
      showToast(
        "Error",
        "No active session to populate context from.",
        "danger",
      );
      return;
    }
    const payload = {
      current_query: $("#chat-input").val().trim() || null,
      staged_items: window.stagedContextItems || [],
    };
    showToast("Info", "Fetching LLMCore context...", "info");
    $.ajax({
      url: `/api/sessions/${window.currentLlmSessionId}/context/preview`,
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify(payload),
      dataType: "json",
      success: function (data) {
        if (
          data &&
          data.prepared_messages &&
          data.prepared_messages.length > 0
        ) {
          const formattedMessages = data.prepared_messages
            .map(
              (msg) =>
                `--- ROLE: ${msg.role.toUpperCase()} ---\n\n${msg.content}`,
            )
            .join("\n\n\n");
          $("#prompt-workbench-textarea")
            .val(formattedMessages)
            .trigger("input");
          showToast(
            "Success",
            "Prompt Workbench populated from LLMCore context.",
            "success",
          );
        } else {
          showToast(
            "Warning",
            "Could not populate workbench: No prepared messages returned.",
            "warning",
          );
        }
      },
      error: function (jqXHR) {
        showToast(
          "Error",
          `Failed to populate workbench: ${escapeHtml(jqXHR.responseJSON?.error || "Unknown error")}`,
          "danger",
        );
      },
    });
  });

  console.log("Context Workbench UI event listeners initialized.");
}
