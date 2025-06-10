// llmchat_web/static/js/prompt_manager_ui.js

/**
 * @file prompt_manager_ui.js
 * @description Handles all UI logic for the Prompt Management tab.
 * This includes fetching, displaying, creating, updating, and deleting
 * context presets and their individual items.
 *
 * It depends on utils.js for helper functions like showToast() and escapeHtml().
 */

// State variable to hold the currently loaded preset data for editing.
let currentlyEditingPreset = null;
// State variable to hold the items of the preset being edited.
let presetEditorItems = [];
// State variable to track the item being edited in the modal.
let editingItemId = null;

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
  const url = isCreating
    ? "/api/presets"
    : `/api/presets/${encodeURIComponent(originalName)}`;
  const method = isCreating ? "POST" : "PUT";

  const payload = {
    name: newName,
    description: description,
    items: presetEditorItems,
    metadata: {}, // Placeholder for future use
  };

  // If we're renaming, we need to handle that via the dedicated endpoint first.
  if (!isCreating && originalName !== newName) {
    $.ajax({
      url: `/api/presets/${encodeURIComponent(originalName)}/rename`,
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify({ new_name: newName }),
    })
      .done(function () {
        // After successful rename, save the content.
        updatePresetContent(newName, payload);
      })
      .fail(function (jqXHR) {
        const errorMsg =
          jqXHR.responseJSON?.error || "Failed to rename preset.";
        showToast("Error", errorMsg, "danger");
      });
  } else {
    // Just updating content, not renaming.
    updatePresetContent(newName, payload);
  }
}

/**
 * Helper function to perform the PUT request for updating preset content.
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
        `Preset '${updatedPreset.name}' saved successfully.`,
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

  console.log("Prompt Manager UI event listeners initialized.");
}
