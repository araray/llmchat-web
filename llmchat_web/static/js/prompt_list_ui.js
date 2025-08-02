// llmchat_web/static/js/prompt_list_ui.js

/**
 * @file prompt_list_ui.js
 * @description Handles UI logic for the list of saved presets in the Prompt Manager tab,
 * including fetching, rendering, and search filtering.
 */

/**
 * Fetches all presets from the backend and renders them in the list.
 */
function fetchAndDisplayPresets() {
  const $list = $("#prompt-preset-list");
  $list.html('<p class="text-muted small p-2">Loading presets...</p>');

  $.ajax({
    url: "/api/presets",
    type: "GET",
    dataType: "json",
    success: function (presets) {
      $list.empty();
      if (presets && presets.length > 0) {
        presets.forEach(function (preset) {
          const $item = $(`
            <a href="#" class="list-group-item list-group-item-action" data-preset-name="${escapeHtml(preset.name)}">
              <div class="d-flex w-100 justify-content-between">
                <h6 class="mb-1">${escapeHtml(preset.name)}</h6>
                <small class="text-muted">${preset.item_count || 0} items</small>
              </div>
              <p class="mb-1 small text-muted">${escapeHtml(preset.description || "No description.")}</p>
            </a>
          `);
          $list.append($item);
        });
      } else {
        $list.html(
          '<p class="text-muted small p-2">No presets found. Create one!</p>',
        );
      }
    },
    error: function (jqXHR) {
      const errorMsg = jqXHR.responseJSON?.error || "Failed to load presets.";
      $list.html(
        `<p class="text-danger small p-2">${escapeHtml(errorMsg)}</p>`,
      );
      showToast("Error", "Could not fetch presets from the server.", "danger");
    },
  });
}

/**
 * Initializes event listeners for the preset list UI.
 */
function initPromptListEventListeners() {
  // Handle clicking on a preset in the list to load it into the editor.
  $("#prompt-preset-list").on("click", ".list-group-item", function (e) {
    e.preventDefault();
    const presetName = $(this).data("preset-name");
    $("#prompt-preset-list .list-group-item.active").removeClass("active");
    $(this).addClass("active");

    $.ajax({
      url: `/api/presets/${encodeURIComponent(presetName)}`,
      type: "GET",
    })
      .done(function (preset) {
        // This function is defined in prompt_editor_ui.js
        displayPresetForEditing(preset);
      })
      .fail(function () {
        showToast("Error", `Could not load preset '${presetName}'.`, "danger");
      });
  });

  // Handle "New Preset" button click.
  $("#btn-new-prompt-preset").on("click", clearAndShowNewPresetForm); // Defined in prompt_editor_ui.js

  // Handle search input filtering.
  $("#prompt-preset-search-input").on("keyup", function () {
    const searchTerm = $(this).val().toLowerCase();
    $("#prompt-preset-list .list-group-item").each(function () {
      const presetName = $(this).data("preset-name").toLowerCase();
      $(this).toggle(presetName.includes(searchTerm));
    });
  });

  console.log("Prompt List UI event listeners initialized.");
}
