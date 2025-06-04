// llmchat_web/static/js/prompt_template_ui.js

/**
 * @file prompt_template_ui.js
 * @description Handles UI logic for RAG Prompt Template Values in the Settings tab.
 * Depends on utils.js for helper functions (escapeHtml, showToast) and
 * accesses/modifies the global variable `currentPromptTemplateValues` from custom.js.
 */

/**
 * Renders the prompt template values in the settings table.
 * Relies on global `currentPromptTemplateValues` and `escapeHtml`.
 */
function renderPromptTemplateValuesTable() {
  const $tbody = $("#prompt-values-tbody");
  $tbody.empty(); // Clear existing rows

  // Access global currentPromptTemplateValues from custom.js
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
          $(
            '<button class="btn btn-danger btn-sm btn-delete-prompt-value" title="Delete Value"><i class="fas fa-trash-alt fa-xs"></i></button>',
          ).attr("data-key", key),
        ),
      );
      $tbody.append($row);
    }
  }
  console.log("PROMPT_UI: Prompt template values table rendered.");
}

/**
 * Fetches current prompt template values from the backend and updates the UI.
 * Primarily uses global `currentPromptTemplateValues` for rendering,
 * with a fallback AJAX call if needed (though initial load should populate it).
 * Relies on `renderPromptTemplateValuesTable` and `showToast`.
 */
function fetchAndDisplayPromptTemplateValues() {
  console.log("PROMPT_UI: Fetching and displaying prompt template values...");
  // Access global currentPromptTemplateValues from custom.js
  if (
    currentPromptTemplateValues &&
    typeof currentPromptTemplateValues === "object" &&
    Object.keys(currentPromptTemplateValues).length > 0
  ) {
    renderPromptTemplateValuesTable();
  } else {
    // Fallback: if global state is empty, try fetching from server.
    // This might be useful if the settings tab is the first interaction point for these values.
    $.ajax({
      url: "/api/settings/prompt_template_values",
      type: "GET",
      dataType: "json",
      success: function (response) {
        console.log(
          "PROMPT_UI: Prompt template values received (fallback fetch):",
          response,
        );
        if (response && typeof response.prompt_template_values === "object") {
          // Update global currentPromptTemplateValues from custom.js
          window.currentPromptTemplateValues = response.prompt_template_values;
        } else {
          window.currentPromptTemplateValues = {}; // Default to empty object
        }
        renderPromptTemplateValuesTable();
      },
      error: function (jqXHR, textStatus, errorThrown) {
        console.error(
          "PROMPT_UI: Error fetching prompt template values (fallback fetch):",
          textStatus,
          errorThrown,
        );
        window.currentPromptTemplateValues = {}; // Reset on error
        renderPromptTemplateValuesTable(); // Render empty or error state
        showToast("Error", "Failed to load prompt template values.", "danger"); // showToast from utils.js
      },
    });
  }
}

/**
 * Initializes event listeners for Prompt Template Values controls.
 */
function initPromptTemplateEventListeners() {
  // Add/Update a prompt template value
  $("#form-add-prompt-value").on("submit", function (e) {
    e.preventDefault();
    const key = $("#new-prompt-key").val().trim();
    const value = $("#new-prompt-value").val().trim();
    if (!key || !value) {
      showToast(
        // showToast from utils.js
        "Error",
        "Both key and value are required for prompt template values.",
        "danger",
      );
      return;
    }
    console.log(`PROMPT_UI: Adding prompt template value: ${key} = ${value}`);
    $.ajax({
      url: "/api/settings/prompt_template_values/update",
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify({ key: key, value: value }),
      dataType: "json",
      success: function (response) {
        if (response && response.prompt_template_values) {
          // Update global currentPromptTemplateValues from custom.js
          window.currentPromptTemplateValues = response.prompt_template_values;
          renderPromptTemplateValuesTable();
          $("#form-add-prompt-value")[0].reset();
          showToast(
            "Success",
            `Prompt value for '${escapeHtml(key)}' saved.`, // escapeHtml from utils.js
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

  // Delete a specific prompt template value
  $("#prompt-values-tbody").on(
    "click",
    ".btn-delete-prompt-value",
    function () {
      const keyToDelete = $(this).data("key");
      showToast(
        // showToast from utils.js
        "Confirm",
        `Delete prompt value for key "${escapeHtml(keyToDelete)}"?`, // escapeHtml from utils.js
        "warning",
        true,
        function (confirmed) {
          if (confirmed) {
            console.log(
              `PROMPT_UI: Deleting prompt template value for key: ${keyToDelete}`,
            );
            $.ajax({
              url: "/api/settings/prompt_template_values/delete_key",
              type: "POST",
              contentType: "application/json",
              data: JSON.stringify({ key: keyToDelete }),
              dataType: "json",
              success: function (response) {
                if (response && response.prompt_template_values) {
                  // Update global currentPromptTemplateValues from custom.js
                  window.currentPromptTemplateValues =
                    response.prompt_template_values;
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

  // Clear all prompt template values
  $("#btn-clear-all-prompt-values").on("click", function () {
    showToast(
      // showToast from utils.js
      "Confirm",
      "Clear all prompt template values for this session?",
      "warning",
      true,
      function (confirmed) {
        if (confirmed) {
          console.log("PROMPT_UI: Clearing all prompt template values.");
          $.ajax({
            url: "/api/settings/prompt_template_values/clear_all",
            type: "POST",
            dataType: "json",
            success: function (response) {
              if (response && response.prompt_template_values !== undefined) {
                // Update global currentPromptTemplateValues from custom.js
                window.currentPromptTemplateValues =
                  response.prompt_template_values;
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

  // When settings tab is shown, ensure prompt template values are up-to-date.
  // This is part of the original logic for the settings tab.
  $("#settings-tab-btn").on("shown.bs.tab", function () {
    console.log(
      "PROMPT_UI: Settings tab shown, ensuring prompt template values are displayed.",
    );
    fetchAndDisplayPromptTemplateValues();
  });

  console.log("Prompt Template UI event listeners initialized.");
}
