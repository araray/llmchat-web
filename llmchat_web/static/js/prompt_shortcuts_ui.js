// llmchat_web/static/js/prompt_shortcuts_ui.js

/**
 * @file prompt_shortcuts_ui.js
 * @description Handles UI logic for the prompt shortcuts feature, including the
 * quick-access bar and the full shortcuts modal.
 */

const FAVORITE_PRESETS_KEY = "llmchat_favorite_presets"; // Shared with editor UI

/**
 * Retrieves the list of favorite preset names from localStorage.
 * @returns {Array<string>} An array of favorite preset names.
 */
function getFavoritePresets() {
  try {
    return JSON.parse(localStorage.getItem(FAVORITE_PRESETS_KEY)) || [];
  } catch (e) {
    console.error("Failed to parse favorite presets from localStorage:", e);
    return [];
  }
}

/**
 * Saves the list of favorite preset names to localStorage.
 * @param {Array<string>} favorites - The array of favorite preset names to save.
 */
function setFavoritePresets(favorites) {
  try {
    localStorage.setItem(FAVORITE_PRESETS_KEY, JSON.stringify(favorites));
  } catch (e) {
    console.error("Failed to save favorite presets to localStorage:", e);
  }
}

/**
 * Toggles the favorite status of a given preset.
 * @param {string} presetName - The name of the preset to toggle.
 */
function toggleFavoritePreset(presetName) {
  if (!presetName) return;
  let favorites = getFavoritePresets();
  const index = favorites.indexOf(presetName);
  if (index > -1) {
    favorites.splice(index, 1); // Unfavorite
  } else {
    favorites.push(presetName); // Favorite
  }
  setFavoritePresets(favorites);
  updateFavoriteStarUI(presetName);
  renderQuickPromptBar();
}

/**
 * Updates the visual state of the favorite star icon in the editor.
 * @param {string} presetName - The name of the currently displayed preset.
 */
function updateFavoriteStarUI(presetName) {
  const favorites = getFavoritePresets();
  const isFavorite = favorites.includes(presetName);
  const $star = $("#btn-toggle-favorite-preset");
  if (isFavorite) {
    $star
      .removeClass("far")
      .addClass("fas text-warning")
      .attr("title", "Remove from favorites");
  } else {
    $star
      .removeClass("fas text-warning")
      .addClass("far")
      .attr("title", "Add to favorites");
  }
}

/**
 * Renders the Quick Prompt Bar with buttons for favorited presets.
 */
function renderQuickPromptBar() {
  const favorites = getFavoritePresets();
  const $bar = $("#quick-prompt-bar");
  $bar.find(".quick-prompt-btn").remove(); // Clear existing buttons

  if (favorites.length > 0) {
    favorites.slice(0, 10).forEach((name) => {
      const $button = $("<button>", {
        class:
          "btn btn-sm btn-outline-secondary me-1 mb-1 quick-prompt-btn apply-prompt-shortcut",
        text: escapeHtml(name),
        "data-preset-name": name,
        title: `Apply preset: ${escapeHtml(name)}`,
      });
      $bar.append($button);
    });
    $bar.show();
  } else {
    $bar.hide();
  }
}

/**
 * Fetches a preset by name and applies its content to the chat and workbench inputs.
 * @param {string} presetName - The name of the preset to apply.
 */
function applyPromptPreset(presetName) {
  if (!presetName) return;
  console.log(`PROMPT_SHORTCUTS_UI: Applying preset: ${presetName}`);

  $.ajax({ url: `/api/presets/${encodeURIComponent(presetName)}`, type: "GET" })
    .done(function (preset) {
      const fullContent = preset.items
        .map((item) => item.content || `[File: ${item.source_identifier}]`)
        .join("\n\n---\n\n");
      const summary =
        fullContent.substring(0, 250) + (fullContent.length > 250 ? "..." : "");

      $("#chat-input").val(summary);
      $("#prompt-workbench-textarea").val(fullContent).trigger("input");

      if (!$("#context-mode-toggle").is(":checked")) {
        $("#context-mode-toggle").prop("checked", true).trigger("change");
      }
      new bootstrap.Tab(
        document.getElementById("context-manager-tab-btn"),
      ).show();

      showToast(
        "Success",
        `Preset '${presetName}' applied to Prompt Workbench.`,
        "success",
      );

      const shortcutsModal = bootstrap.Modal.getInstance(
        document.getElementById("promptShortcutsModal"),
      );
      if (shortcutsModal) shortcutsModal.hide();
    })
    .fail(() =>
      showToast("Error", `Failed to apply preset '${presetName}'.`, "danger"),
    );
}

/**
 * Initializes event listeners for the prompt shortcuts UI.
 */
function initPromptShortcutsEventListeners() {
  // Handle click on the "magic wand" button to show the full shortcut modal
  $("#btn-show-prompt-shortcuts").on("click", function () {
    const $list = $("#prompt-shortcut-modal-list");
    $list.html('<p class="text-muted small p-2">Loading presets...</p>');
    $.ajax({ url: "/api/presets", type: "GET", dataType: "json" })
      .done(function (presets) {
        $list.empty();
        if (presets && presets.length > 0) {
          presets
            .sort((a, b) => a.name.localeCompare(b.name))
            .forEach(function (preset) {
              $list.append(
                `<a href="#" class="list-group-item list-group-item-action apply-prompt-shortcut" data-preset-name="${escapeHtml(preset.name)}">${escapeHtml(preset.name)}<p class="mb-1 small text-muted">${escapeHtml(preset.description || "")}</p></a>`,
              );
            });
        } else {
          $list.html('<p class="text-muted small p-2">No presets found.</p>');
        }
      })
      .fail(() =>
        $list.html(
          '<p class="text-danger small p-2">Failed to load presets.</p>',
        ),
      );
    new bootstrap.Modal(document.getElementById("promptShortcutsModal")).show();
  });

  // Handle clicks on quick bar buttons or modal links to apply presets
  $("body").on("click", ".apply-prompt-shortcut", function (e) {
    e.preventDefault();
    applyPromptPreset($(this).data("preset-name"));
  });

  // Filter list in the shortcut modal
  $("#prompt-shortcut-modal-search").on("keyup", function () {
    const searchTerm = $(this).val().toLowerCase();
    $("#prompt-shortcut-modal-list .list-group-item").each(function () {
      $(this).toggle(
        $(this).data("preset-name").toLowerCase().includes(searchTerm),
      );
    });
  });

  // Initial render of the quick prompt bar
  renderQuickPromptBar();

  console.log("Prompt Shortcuts UI event listeners initialized.");
}
