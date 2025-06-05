// llmchat_web/static/js/rag_ui.js

/**
 * @file rag_ui.js
 * @description Handles RAG (Retrieval Augmented Generation) UI controls,
 * API calls for RAG settings, collections, direct search, and rendering results.
 * Depends on utils.js for helper functions (escapeHtml, showToast) and
 * accesses global variables from custom.js (currentRagSettings).
 */

/**
 * Fetches available RAG collections and populates the dropdown.
 * Relies on global `currentRagSettings` to set the selected value.
 * Uses global `escapeHtml`.
 */
function fetchAndPopulateRagCollections() {
  console.log("RAG_UI: Fetching RAG collections...");
  $.ajax({
    url: "/api/rag/collections", // Correct endpoint
    type: "GET",
    dataType: "json",
    success: function (collections) {
      const $select = $("#rag-collection-select");
      $select
        .empty()
        .append('<option selected value="">Select Collection...</option>');
      if (collections && collections.length > 0) {
        collections.forEach(function (collection) {
          // Assuming collection can be a string or an object with name/id
          const collectionName =
            typeof collection === "string"
              ? collection
              : collection.name || collection.id; // Prefer name, fallback to id
          const collectionValue =
            typeof collection === "string"
              ? collection
              : collection.id || collection.name; // Prefer id if available, else name
          $select.append(
            $("<option>", {
              value: collectionValue,
              text: escapeHtml(collectionName), // escapeHtml from utils.js
            }),
          );
        });
        // Ensure currentRagSettings and its properties are checked before use
        if (
          window.currentRagSettings &&
          window.currentRagSettings.collectionName
        ) {
          $select.val(window.currentRagSettings.collectionName);
        } else if (!window.currentRagSettings) {
          console.warn(
            "RAG_UI: window.currentRagSettings is undefined during collection population.",
          );
        }
      } else {
        $select.append(
          '<option value="" disabled>No collections found</option>',
        );
      }
    },
    error: function (jqXHR, textStatus, errorThrown) {
      console.error(
        "RAG_UI: Error fetching RAG collections:",
        textStatus,
        errorThrown,
        jqXHR.responseText,
      );
      $("#rag-collection-select")
        .empty()
        .append('<option value="" disabled>Error loading collections</option>');
    },
  });
}

/**
 * Updates the state of RAG controls in the UI based on global `currentRagSettings`.
 * Uses global `escapeHtml`.
 */
function updateRagControlsState() {
  // Ensure currentRagSettings exists before accessing its properties
  const ragSettings = window.currentRagSettings || {};
  const isEnabled = ragSettings.enabled || false;
  const collectionName = ragSettings.collectionName || null;
  const kValue = ragSettings.kValue || 3;
  const filter = ragSettings.filter || null;

  $("#rag-toggle-switch").prop("checked", isEnabled);
  const controlsShouldBeDisabled = !isEnabled;

  $("#rag-collection-select").prop("disabled", controlsShouldBeDisabled);
  if (collectionName) {
    // Only set value if a collection name is actually stored
    $("#rag-collection-select").val(collectionName);
  }

  $("#rag-k-value").prop("disabled", controlsShouldBeDisabled).val(kValue);
  $("#rag-filter-input")
    .prop("disabled", controlsShouldBeDisabled)
    .val(
      filter && Object.keys(filter).length > 0 ? JSON.stringify(filter) : "",
    );

  const $ragStatusEl = $("#status-rag");
  if (isEnabled) {
    let statusText = `ON (${escapeHtml(collectionName) || "Default"}, K:${kValue || "Def"})`;
    if (filter && Object.keys(filter).length > 0) {
      statusText += " Filter*";
    }
    $ragStatusEl
      .text(statusText)
      .removeClass("bg-danger")
      .addClass("bg-success");
  } else {
    $ragStatusEl.text("OFF").removeClass("bg-success").addClass("bg-danger");
  }
  console.log("RAG_UI: RAG controls state updated based on:", ragSettings);
}

/**
 * Sends updated RAG settings (from global `currentRagSettings`) to the backend.
 * Uses global `showToast`.
 */
function sendRagSettingsUpdate() {
  // Ensure currentRagSettings exists before use
  const ragSettings = window.currentRagSettings || {};
  console.log("RAG_UI: Sending RAG settings update to backend:", ragSettings);

  let filterToSend = ragSettings.filter;
  // If filter is an empty string from input, treat as null. If it's already null/obj, pass as is.
  if (typeof filterToSend === "string" && filterToSend.trim() === "") {
    filterToSend = null;
  }

  const payload = {
    enabled: ragSettings.enabled || false,
    collectionName: ragSettings.collectionName || null,
    kValue: ragSettings.kValue || 3,
    filter: filterToSend, // This will be null or an object
  };

  $.ajax({
    url: "/api/rag/settings/update", // Corrected URL
    type: "POST",
    contentType: "application/json",
    data: JSON.stringify(payload),
    dataType: "json",
    success: function (response) {
      console.log(
        "RAG_UI: RAG settings updated successfully on backend:",
        response,
      );
      if (response && response.rag_settings) {
        // Ensure window.currentRagSettings is initialized if it was undefined
        if (
          typeof window.currentRagSettings === "undefined" ||
          window.currentRagSettings === null
        ) {
          console.warn(
            "RAG_UI: window.currentRagSettings was undefined/null in AJAX success. Re-initializing.",
          );
          window.currentRagSettings = {
            enabled: false,
            collectionName: null,
            kValue: 3,
            filter: null,
          };
        }
        // Update the global currentRagSettings
        window.currentRagSettings.enabled = response.rag_settings.enabled;
        window.currentRagSettings.collectionName =
          response.rag_settings.collection_name;
        window.currentRagSettings.kValue = response.rag_settings.k_value;
        // Backend now sends filter as object or null.
        window.currentRagSettings.filter = response.rag_settings.filter;

        console.log(
          "RAG_UI: Global currentRagSettings updated:",
          window.currentRagSettings,
        );
      }
      updateRagControlsState(); // Re-render controls based on (potentially updated) global state
    },
    error: function (jqXHR, textStatus, errorThrown) {
      console.error(
        "RAG_UI: Error updating RAG settings on backend:",
        textStatus,
        errorThrown,
        jqXHR.responseText,
      );
      showToast(
        "Error",
        `Failed to update RAG settings: ${jqXHR.responseJSON ? jqXHR.responseJSON.error : errorThrown}`,
        "danger",
      );
    },
  });
}

/**
 * Renders the results of a Direct RAG Search into the modal.
 * Uses global `escapeHtml`.
 * @param {Array} results - Array of document objects from the backend.
 */
function renderDirectRagSearchResults(results) {
  const $modalBody = $("#directRagSearchResultsBody").empty();
  if (!results || results.length === 0) {
    $modalBody.append(
      '<p class="text-muted">No results found for your query.</p>',
    );
    return;
  }

  const $listGroup = $('<ul class="list-group list-group-flush"></ul>');
  results.forEach(function (doc) {
    const scoreDisplay =
      doc.score !== null && doc.score !== undefined
        ? `<strong>Score:</strong> ${doc.score.toFixed(4)}`
        : "Score: N/A";
    const metadataDisplay = doc.metadata
      ? `<small class="text-muted d-block">Metadata: ${escapeHtml(JSON.stringify(doc.metadata).substring(0, 100))}...</small>`
      : "";
    const contentPreview = doc.content
      ? `<pre>${escapeHtml(doc.content.substring(0, 250))}${doc.content.length > 250 ? "..." : ""}</pre>`
      : '<p class="text-muted small">No content preview.</p>';

    const $listItem = $(`
            <li class="list-group-item">
                <div><strong>ID:</strong> ${escapeHtml(doc.id)}</div>
                <div>${scoreDisplay}</div>
                ${metadataDisplay}
                <div class="mt-1">Content Preview:</div>
                ${contentPreview}
            </li>
        `);
    $listGroup.append($listItem);
  });
  $modalBody.append($listGroup);
  console.log("RAG_UI: Direct RAG search results rendered.");
}

/**
 * Handles the submission of the Direct RAG Search form.
 * Relies on global `currentRagSettings`, `showToast`, `escapeHtml`.
 * Calls `renderDirectRagSearchResults`.
 */
function handleDirectRagSearch() {
  const query = $("#direct-rag-search-query").val().trim();
  if (!query) {
    showToast(
      "Error",
      "Please enter a search query for Direct RAG Search.",
      "danger",
    );
    return;
  }
  // Use global currentRagSettings from custom.js or default if undefined
  const ragSettingsToUse = window.currentRagSettings || {
    collectionName: null,
    kValue: 3,
    filter: null,
  };

  const payload = {
    query: query,
    collection_name: ragSettingsToUse.collectionName,
    k: ragSettingsToUse.kValue,
    filter: ragSettingsToUse.filter,
  };

  console.log("RAG_UI: Performing Direct RAG Search with payload:", payload);
  $("#directRagSearchResultsBody").html(
    '<p class="text-muted">Searching...</p>',
  );
  var searchModal = new bootstrap.Modal(
    document.getElementById("directRagSearchResultsModal"),
  );
  searchModal.show();

  $.ajax({
    url: "/api/rag/direct_search", // Correct endpoint
    type: "POST",
    contentType: "application/json",
    data: JSON.stringify(payload),
    dataType: "json",
    success: function (results) {
      console.log("RAG_UI: Direct RAG Search results:", results);
      renderDirectRagSearchResults(results);
    },
    error: function (jqXHR, textStatus, errorThrown) {
      console.error(
        "RAG_UI: Direct RAG Search error:",
        textStatus,
        errorThrown,
        jqXHR.responseText,
      );
      const errorMsg = jqXHR.responseJSON
        ? jqXHR.responseJSON.error
        : "Failed to perform RAG search.";
      $("#directRagSearchResultsBody").html(
        `<p class="text-danger">Error: ${escapeHtml(errorMsg)}</p>`,
      );
      showToast("Error", `Direct RAG Search failed: ${errorMsg}`, "danger");
    },
  });
}

/**
 * Initializes event listeners for RAG controls.
 */
function initRagEventListeners() {
  $("#rag-tab-btn").on("shown.bs.tab", function () {
    fetchAndPopulateRagCollections();
    updateRagControlsState();
  });

  $("#rag-toggle-switch").on("change", function () {
    if (
      typeof window.currentRagSettings === "undefined" ||
      window.currentRagSettings === null
    )
      window.currentRagSettings = {};
    window.currentRagSettings.enabled = $(this).is(":checked");
    sendRagSettingsUpdate();
  });

  $("#rag-collection-select").on("change", function () {
    if (
      typeof window.currentRagSettings === "undefined" ||
      window.currentRagSettings === null
    )
      window.currentRagSettings = {};
    window.currentRagSettings.collectionName = $(this).val() || null;
    sendRagSettingsUpdate();
  });

  $("#rag-k-value").on("change", function () {
    const val = parseInt($(this).val(), 10);
    if (
      typeof window.currentRagSettings === "undefined" ||
      window.currentRagSettings === null
    )
      window.currentRagSettings = {};
    window.currentRagSettings.kValue = isNaN(val) ? 3 : val;
    sendRagSettingsUpdate();
  });

  $("#rag-filter-input").on("change", function () {
    const filterStr = $(this).val().trim();
    if (
      typeof window.currentRagSettings === "undefined" ||
      window.currentRagSettings === null
    )
      window.currentRagSettings = {};
    if (filterStr === "") {
      window.currentRagSettings.filter = null;
    } else {
      try {
        const parsedFilter = JSON.parse(filterStr);
        if (typeof parsedFilter === "object" && parsedFilter !== null) {
          window.currentRagSettings.filter = parsedFilter;
        } else {
          showToast(
            "Error",
            'Invalid JSON for RAG filter. It must be an object (e.g., {"key": "value"}). Sticking to previous value.',
            "danger",
          );
          // Revert input to previous valid state
          $(this).val(
            window.currentRagSettings.filter &&
              Object.keys(window.currentRagSettings.filter).length > 0
              ? JSON.stringify(window.currentRagSettings.filter)
              : "",
          );
          return;
        }
      } catch (e) {
        showToast(
          "Error",
          "Invalid JSON format for RAG filter. Sticking to previous value.",
          "danger",
        );
        // Revert input to previous valid state
        $(this).val(
          window.currentRagSettings.filter &&
            Object.keys(window.currentRagSettings.filter).length > 0
            ? JSON.stringify(window.currentRagSettings.filter)
            : "",
        );
        return;
      }
    }
    sendRagSettingsUpdate();
  });

  $("#direct-rag-search-form").on("submit", function (e) {
    e.preventDefault();
    handleDirectRagSearch();
  });
  console.log("RAG UI event listeners initialized.");
}
