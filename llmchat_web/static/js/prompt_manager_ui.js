// llmchat_web/static/js/prompt_manager_ui.js

/**
 * @file prompt_manager_ui.js
 * @description Handles all UI logic for the Prompt Management tab and prompt shortcuts.
 * This includes fetching, displaying, creating, updating, and deleting
 * context presets, as well as managing favorites and applying presets to the chat UI.
 *
 * It depends on utils.js for helper functions like showToast() and escapeHtml().
 */

// State variable to hold the currently loaded preset data for editing.
let currentlyEditingPreset = null;
// State variable to hold the items of the preset being edited.
let presetEditorItems = [];
// State variable to track the item being edited in the modal.
let editingItemId = null;
// Key for localStorage
const FAVORITE_PRESETS_KEY = "llmchat_favorite_presets";

// =================================================================================
// SECTION: Preset List Management
// =================================================================================

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

// =================================================================================
// SECTION: Favorite Preset Management (for Shortcuts)
// =================================================================================

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
  renderQuickPromptBar(); // Re-render the bar after toggling
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
    $star.removeClass("far").addClass("fas text-warning");
    $star.attr("title", "Remove from favorites");
  } else {
    $star.removeClass("fas text-warning").addClass("far");
    $star.attr("title", "Add to favorites");
  }
}

// =================================================================================
// SECTION: Preset Editor UI
// =================================================================================

/**
 * Switches the right-hand pane to show the editor form.
 */
function showPresetEditor() {
  $("#prompt-preset-welcome-pane").addClass("d-none");
  $("#prompt-preset-editor-pane").removeClass("d-none");
}

/**
 * Switches the right-hand pane to show the welcome/placeholder message.
 */
function showPresetWelcomePane() {
  $("#prompt-preset-editor-pane").addClass("d-none");
  $("#prompt-preset-welcome-pane").removeClass("d-none");
}

/**
 * Populates the editor form with the data of a specific preset.
 * @param {object} preset - The full preset object from the backend.
 */
function displayPresetForEditing(preset) {
  currentlyEditingPreset = preset;
  presetEditorItems = preset.items.map((item) => ({ ...item })); // Deep copy items for local editing

  $("#prompt-preset-editor-original-name").val(preset.name);
  $("#prompt-preset-name").val(preset.name);
  $("#prompt-preset-description").val(preset.description || "");

  renderPresetItemsList();
  updateFavoriteStarUI(preset.name);
  // TODO: Render template values once that feature is added.

  showPresetEditor();
}

/**
 * Clears the editor form to prepare for creating a new preset.
 */
function clearAndShowNewPresetForm() {
  currentlyEditingPreset = null;
  presetEditorItems = [];

  $("#prompt-preset-editor-original-name").val("");
  $("#prompt-preset-name").val("").prop("disabled", false);
  $("#prompt-preset-description").val("");

  renderPresetItemsList();
  updateFavoriteStarUI(null); // Reset star to non-favorite state
  // TODO: Clear template values UI once added.

  $("#prompt-preset-list .list-group-item.active").removeClass("active");
  showPresetEditor();
}

// =================================================================================
// SECTION: Preset Items Management (in the Editor)
// =================================================================================

/**
 * Renders the list of items for the currently editing preset.
 */
function renderPresetItemsList() {
  const $list = $("#prompt-preset-items-list").empty();
  if (presetEditorItems.length === 0) {
    $list.html(
      '<p class="text-muted small text-center p-3">No items in this preset. Click "Add Item" to start.</p>',
    );
    return;
  }

  presetEditorItems.forEach(function (item, index) {
    const contentPreview =
      item.type === "preset_file_reference"
        ? `Path: ${item.source_identifier || "Not set"}`
        : (item.content || "").substring(0, 100) + "...";

    const $itemDiv = $(`
            <div class="staged-context-item" data-item-id="${escapeHtml(item.item_id)}">
                <div class="staged-item-header">
                    ${escapeHtml(item.type.replace(/_/g, " ").replace(/(?:^|\s)\S/g, (a) => a.toUpperCase()))}
                </div>
                <div class="staged-item-content-preview">
                    ${escapeHtml(contentPreview)}
                </div>
                <div class="staged-item-actions mt-1">
                    <button class="btn btn-sm btn-outline-warning btn-edit-preset-item" title="Edit Item"><i class="fas fa-edit fa-xs"></i></button>
                    <button class="btn btn-sm btn-outline-danger btn-remove-preset-item" title="Remove Item"><i class="fas fa-trash-alt fa-xs"></i></button>
                </div>
            </div>
        `);
    $list.append($itemDiv);
  });
}

/**
 * Opens and configures the item editor modal for creating a new item.
 */
function openNewPresetItemModal() {
  editingItemId = null; // Ensure we're in "new item" mode
  $("#promptPresetItemModalLabel").text("Add New Preset Item");
  $("#preset-item-editor-item-id").val("");
  $("#preset-item-type-select").val("preset_text_content").trigger("change");
  $("#preset-item-content-input").val("");
  $("#preset-item-path-input").val("");
  $("#preset-item-metadata-input").val("");
  const itemModal = new bootstrap.Modal(
    document.getElementById("promptPresetItemModal"),
  );
  itemModal.show();
}

/**
 * Opens and populates the item editor modal for editing an existing item.
 * @param {string} itemId - The ID of the item to edit.
 */
function openEditPresetItemModal(itemId) {
  const item = presetEditorItems.find((i) => i.item_id === itemId);
  if (!item) {
    showToast("Error", "Could not find the item to edit.", "danger");
    return;
  }

  editingItemId = itemId;
  $("#promptPresetItemModalLabel").text("Edit Preset Item");
  $("#preset-item-editor-item-id").val(item.item_id);
  $("#preset-item-type-select").val(item.type).trigger("change");
  $("#preset-item-content-input").val(item.content || "");
  $("#preset-item-path-input").val(
    item.type === "preset_file_reference" ? item.source_identifier : "",
  );
  $("#preset-item-metadata-input").val(
    item.metadata ? JSON.stringify(item.metadata, null, 2) : "",
  );

  const itemModal = new bootstrap.Modal(
    document.getElementById("promptPresetItemModal"),
  );
  itemModal.show();
}

// =================================================================================
// SECTION: Prompt Shortcut Rendering and Application
// =================================================================================

/**
 * Renders the Quick Prompt Bar with buttons for favorited presets.
 */
function renderQuickPromptBar() {
  const favorites = getFavoritePresets();
  const $bar = $("#quick-prompt-bar");
  // Clear everything except the "Quick Prompts:" label
  $bar.find(".quick-prompt-btn").remove();

  if (favorites.length > 0) {
    favorites.slice(0, 10).forEach((name) => {
      // Show up to 10 favorites
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
  console.log("Prompt Manager UI: Quick Prompt Bar updated.");
}

/**
 * Fetches all presets and populates the list in the shortcuts modal.
 */
function populateShortcutsModal() {
  const $list = $("#prompt-shortcut-modal-list");
  $list.html('<p class="text-muted small p-2">Loading presets...</p>');
  $.ajax({
    url: "/api/presets",
    type: "GET",
    dataType: "json",
  })
    .done(function (presets) {
      $list.empty();
      if (presets && presets.length > 0) {
        presets
          .sort((a, b) => a.name.localeCompare(b.name))
          .forEach(function (preset) {
            const $item = $(`
                    <a href="#" class="list-group-item list-group-item-action apply-prompt-shortcut" data-preset-name="${escapeHtml(preset.name)}">
                      ${escapeHtml(preset.name)}
                      <p class="mb-1 small text-muted">${escapeHtml(preset.description || "")}</p>
                    </a>
                `);
            $list.append($item);
          });
      } else {
        $list.html('<p class="text-muted small p-2">No presets found.</p>');
      }
    })
    .fail(function () {
      $list.html(
        '<p class="text-danger small p-2">Failed to load presets.</p>',
      );
    });
}

/**
 * Fetches a preset by name and applies its content to the chat and workbench inputs.
 * @param {string} presetName - The name of the preset to apply.
 */
function applyPromptPreset(presetName) {
  if (!presetName) return;
  console.log(`PROMPT_UI: Applying preset: ${presetName}`);

  $.ajax({
    url: `/api/presets/${encodeURIComponent(presetName)}`,
    type: "GET",
  })
    .done(function (preset) {
      // As per spec, handle placeholders later. For now, just join content.
      let fullContent = preset.items
        .map((item) => {
          if (item.type === "preset_file_reference") {
            return `[Content from file: ${item.source_identifier || "unknown path"}]`; // Placeholder for now
          }
          return item.content || "";
        })
        .join("\n\n---\n\n");

      // The spec requires setting the chat input to a summary and the workbench to the full content.
      // For simplicity here, we'll put a summary in chat and full content in workbench.
      let summaryForChatInput =
        fullContent.substring(0, 250) + (fullContent.length > 250 ? "..." : "");

      $("#chat-input").val(summaryForChatInput);
      $("#prompt-workbench-textarea").val(fullContent).trigger("input");

      // CRUCIALLY: Switch to UI Managed mode and show the correct tab.
      if (!$("#context-mode-toggle").is(":checked")) {
        $("#context-mode-toggle").prop("checked", true).trigger("change");
      }
      const contextTab = new bootstrap.Tab(
        document.getElementById("context-manager-tab-btn"),
      );
      contextTab.show();

      showToast(
        "Success",
        `Preset '${presetName}' applied to Prompt Workbench.`,
        "success",
      );

      // Close the shortcuts modal if it's open.
      const shortcutsModal = bootstrap.Modal.getInstance(
        document.getElementById("promptShortcutsModal"),
      );
      if (shortcutsModal) {
        shortcutsModal.hide();
      }
    })
    .fail(function () {
      showToast(
        "Error",
        `Failed to load and apply preset '${presetName}'.`,
        "danger",
      );
    });
}

// =================================================================================
// SECTION: API Call Handlers
// =================================================================================

/**
 * Handles the logic for saving a preset (create or update).
 */
function savePreset() {
  const originalName = $("#prompt-preset-editor-original-name").val();
  const newName = $("#prompt-preset-name").val().trim();
  const description = $("#prompt-preset-description").val().trim();

  if (!newName) {
    showToast("Error", "Preset name cannot be empty.", "danger");
    return;
  }

  const isCreating = !originalName;

  const payload = {
    name: newName,
    description: description,
    items: presetEditorItems,
    metadata: {}, // Placeholder for future use
  };

  // If we're renaming, we must delete the old and create the new, or use a dedicated rename endpoint.
  // The spec defines a dedicated rename endpoint. Let's use it.
  if (!isCreating && originalName !== newName) {
    $.ajax({
      url: `/api/presets/${encodeURIComponent(originalName)}/rename`,
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify({ new_name: newName }),
    })
      .done(function () {
        // After successful rename, save the content to the new name.
        updatePresetContent(newName, payload);
        renderQuickPromptBar(); // Favorites might need updating
      })
      .fail(function (jqXHR) {
        const errorMsg =
          jqXHR.responseJSON?.error || "Failed to rename preset.";
        showToast("Error", errorMsg, "danger");
      });
  } else {
    // Creating a new preset or updating an existing one without renaming
    const url = isCreating
      ? "/api/presets"
      : `/api/presets/${encodeURIComponent(originalName)}`;
    const method = isCreating ? "POST" : "PUT";
    $.ajax({
      url: url,
      type: method,
      contentType: "application/json",
      data: JSON.stringify(payload),
    })
      .done(function (savedPreset) {
        showToast(
          "Success",
          `Preset '${savedPreset.name}' saved successfully.`,
          "success",
        );
        fetchAndDisplayPresets();
        displayPresetForEditing(savedPreset); // Refresh editor with saved data
        renderQuickPromptBar(); // Favorites might need updating
      })
      .fail(function (jqXHR) {
        const errorMsg = jqXHR.responseJSON?.error || "Failed to save preset.";
        showToast("Error", errorMsg, "danger");
      });
  }
}

/**
 * Helper function to perform the PUT request for updating preset content.
 * This is now wrapped into the main savePreset logic to handle renames correctly.
 * @param {string} name - The name of the preset to update.
 * @param {object} payload - The full preset data.
 */
function updatePresetContent(name, payload) {
  $.ajax({
    url: `/api/presets/${encodeURIComponent(name)}`,
    type: "PUT",
    contentType: "application/json",
    data: JSON.stringify(payload),
  })
    .done(function (updatedPreset) {
      showToast(
        "Success",
        `Preset '${updatedPreset.name}' content saved successfully.`,
        "success",
      );
      fetchAndDisplayPresets();
      displayPresetForEditing(updatedPreset); // Refresh editor with saved data
    })
    .fail(function (jqXHR) {
      const errorMsg =
        jqXHR.responseJSON?.error || "Failed to save preset content.";
      showToast("Error", errorMsg, "danger");
    });
}

/**
 * Handles deleting the currently edited preset.
 */
function deletePreset() {
  const presetName = $("#prompt-preset-editor-original-name").val();
  if (!presetName) {
    showToast("Error", "No preset selected to delete.", "danger");
    return;
  }

  showToast(
    "Confirm",
    `Are you sure you want to delete the preset '${presetName}'? This cannot be undone.`,
    "warning",
    true,
    function (confirmed) {
      if (confirmed) {
        $.ajax({
          url: `/api/presets/${encodeURIComponent(presetName)}`,
          type: "DELETE",
        })
          .done(function (response) {
            showToast(
              "Success",
              response.message || "Preset deleted.",
              "success",
            );
            toggleFavoritePreset(presetName); // Remove from favorites if it was favorited
            fetchAndDisplayPresets();
            showPresetWelcomePane();
          })
          .fail(function (jqXHR) {
            const errorMsg =
              jqXHR.responseJSON?.error || "Failed to delete preset.";
            showToast("Error", errorMsg, "danger");
          });
      }
    },
  );
}

// =================================================================================
// SECTION: Event Listeners
// =================================================================================

function initPromptManagerEventListeners() {
  // When the main "Prompts" tab is shown, fetch the list of presets.
  $("#prompts-tab-btn").on("shown.bs.tab", function () {
    fetchAndDisplayPresets();
    showPresetWelcomePane();
  });

  // Handle clicking on a preset in the list.
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
        displayPresetForEditing(preset);
      })
      .fail(function () {
        showToast("Error", `Could not load preset '${presetName}'.`, "danger");
      });
  });

  // Handle "New Preset" button click.
  $("#btn-new-prompt-preset").on("click", clearAndShowNewPresetForm);

  // Handle "Save" button click in the editor.
  $("#btn-save-prompt-preset").on("click", savePreset);

  // Handle "Delete" button click in the editor.
  $("#btn-delete-prompt-preset").on("click", deletePreset);

  // Add favorite star icon to editor header dynamically
  if ($("#btn-toggle-favorite-preset").length === 0) {
    const $starIcon = $("<i>", {
      id: "btn-toggle-favorite-preset",
      class: "far fa-star ms-2",
      style: "cursor: pointer;",
      title: "Add to favorites",
    });
    $("#prompt-preset-editor-pane h5").append($starIcon);
  }

  // Handle "Favorite" star click.
  $("#prompt-preset-editor-pane").on(
    "click",
    "#btn-toggle-favorite-preset",
    function () {
      const presetName = $("#prompt-preset-editor-original-name").val();
      toggleFavoritePreset(presetName);
    },
  );

  // Handle search input filtering.
  $("#prompt-preset-search-input").on("keyup", function () {
    const searchTerm = $(this).val().toLowerCase();
    $("#prompt-preset-list .list-group-item").each(function () {
      const presetName = $(this).data("preset-name").toLowerCase();
      $(this).toggle(presetName.includes(searchTerm));
    });
  });

  // --- Preset Item Editor Listeners ---
  $("#btn-add-preset-item").on("click", openNewPresetItemModal);

  $("#prompt-preset-items-list").on(
    "click",
    ".btn-edit-preset-item",
    function () {
      const itemId = $(this).closest(".staged-context-item").data("item-id");
      openEditPresetItemModal(itemId);
    },
  );

  $("#prompt-preset-items-list").on(
    "click",
    ".btn-remove-preset-item",
    function () {
      const itemId = $(this).closest(".staged-context-item").data("item-id");
      presetEditorItems = presetEditorItems.filter((i) => i.item_id !== itemId);
      renderPresetItemsList();
    },
  );

  // --- Item Editor Modal Listeners ---
  // Toggle fields based on selected item type in the modal.
  $("#preset-item-type-select").on("change", function () {
    const type = $(this).val();
    if (type === "preset_file_reference") {
      $("#preset-item-content-group").hide();
      $("#preset-item-path-group").show();
    } else {
      $("#preset-item-path-group").hide();
      $("#preset-item-content-group").show();
    }
  });

  // Handle saving an item from the modal.
  $("#btn-save-preset-item").on("click", function () {
    let metadata;
    try {
      const metadataStr = $("#preset-item-metadata-input").val().trim();
      metadata = metadataStr ? JSON.parse(metadataStr) : {};
    } catch (e) {
      showToast("Error", "Metadata is not valid JSON.", "danger");
      return;
    }

    const itemData = {
      item_id: $("#preset-item-editor-item-id").val() || `pi_${Date.now()}`,
      type: $("#preset-item-type-select").val(),
      content: $("#preset-item-content-input").val(),
      source_identifier: $("#preset-item-path-input").val(),
      metadata: metadata,
    };

    if (editingItemId) {
      // Update existing item
      const index = presetEditorItems.findIndex(
        (i) => i.item_id === editingItemId,
      );
      if (index > -1) {
        presetEditorItems[index] = itemData;
      }
    } else {
      // Add new item
      presetEditorItems.push(itemData);
    }

    renderPresetItemsList();
    bootstrap.Modal.getInstance(
      document.getElementById("promptPresetItemModal"),
    ).hide();
  });

  // --- Prompt Shortcut Listeners ---
  // Handle click on the "magic wand" button to show the full shortcut modal
  $("#btn-show-prompt-shortcuts").on("click", function () {
    populateShortcutsModal();
    const shortcutsModal = new bootstrap.Modal(
      document.getElementById("promptShortcutsModal"),
    );
    shortcutsModal.show();
  });

  // Handle clicks on quick bar buttons or modal links to apply presets
  $("body").on("click", ".apply-prompt-shortcut", function (e) {
    e.preventDefault();
    const presetName = $(this).data("preset-name");
    applyPromptPreset(presetName);
  });

  // Filter list in the shortcut modal
  $("#prompt-shortcut-modal-search").on("keyup", function () {
    const searchTerm = $(this).val().toLowerCase();
    $("#prompt-shortcut-modal-list .list-group-item").each(function () {
      const presetName = $(this).data("preset-name").toLowerCase();
      $(this).toggle(presetName.includes(searchTerm));
    });
  });

  console.log("Prompt Manager UI event listeners initialized.");
}
