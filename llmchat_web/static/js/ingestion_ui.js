// llmchat_web/static/js/ingestion_ui.js

/**
 * @file ingestion_ui.js
 * @description Handles UI logic for the data ingestion modal, including form submissions
 * and SSE progress updates for file, directory (ZIP), and Git repository ingestion.
 * Depends on utils.js for helper functions (escapeHtml, showToast) and
 * rag_ui.js for fetchAndPopulateRagCollections.
 */

/**
 * Handles the submission of ingestion forms.
 * Uses fetch for SSE to stream progress.
 * Calls global `escapeHtml`, `showToast` (from utils.js) and `fetchAndPopulateRagCollections` (from rag_ui.js).
 * @param {string} ingestType - The type of ingestion ('file', 'dir_zip', 'git').
 * @param {FormData} formData - The form data to submit.
 */
async function handleIngestionFormSubmit(ingestType, formData) {
  const $resultMsg = $("#ingestion-result-message");
  const $progressBar = $("#ingestion-progress-bar");
  const $progressContainer = $("#ingestion-progress-container");

  $resultMsg
    .removeClass("text-success text-danger")
    .addClass("text-muted")
    .text("Processing ingestion request...");
  $progressContainer.show();
  $progressBar
    .css("width", "0%")
    .removeClass("bg-success bg-danger")
    .attr("aria-valuenow", 0)
    .text("Starting...");

  try {
    const response = await fetch("/api/ingest", {
      method: "POST",
      body: formData,
      // No 'Content-Type' header for FormData, browser sets it with boundary
    });

    if (!response.ok) {
      let errorText = `Server error: ${response.status} ${response.statusText}`;
      try {
        const errorData = await response.json();
        errorText = errorData.error || errorText;
      } catch (e) {
        /* Ignore if response is not JSON */
      }
      throw new Error(errorText);
    }

    if (!response.body) {
      throw new Error("Response body is null, cannot read stream.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let filesProcessedInStream = 0;
    let totalFilesFromEvent = 0;

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        console.log("INGEST_UI: Ingestion stream finished by server.");
        if (
          $progressBar.text() !== "Complete!" &&
          $progressBar.text() !== "Failed!" &&
          $progressBar.text() !== "Completed with Errors!"
        ) {
          $progressBar
            .css("width", "100%")
            .addClass("bg-warning")
            .text("Stream ended, awaiting summary...");
        }
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      let eolIndex;
      while ((eolIndex = buffer.indexOf("\n\n")) >= 0) {
        const line = buffer.substring(0, eolIndex).trim();
        buffer = buffer.substring(eolIndex + 2);

        if (line.startsWith("data: ")) {
          try {
            const eventData = JSON.parse(line.substring(6));
            console.log("INGEST_UI SSE Event:", eventData);

            if (eventData.type === "file_start") {
              totalFilesFromEvent =
                eventData.total_files || totalFilesFromEvent;
              $resultMsg.html(
                `Processing file <strong>${escapeHtml(eventData.filename)}</strong> (${eventData.file_index + 1} of ${totalFilesFromEvent})...`,
              );
              $progressBar.text(
                `File ${eventData.file_index + 1}/${totalFilesFromEvent}`,
              );
            } else if (eventData.type === "file_end") {
              filesProcessedInStream++;
              const progressPercent =
                totalFilesFromEvent > 0
                  ? (filesProcessedInStream / totalFilesFromEvent) * 100
                  : 50;
              $progressBar
                .css("width", `${progressPercent}%`)
                .attr("aria-valuenow", progressPercent);
              if (eventData.status === "success") {
                $resultMsg.append(
                  `<br><small class="text-success">- File <strong>${escapeHtml(eventData.filename)}</strong> processed successfully. Chunks added: ${eventData.chunks_added || 0}</small>`,
                );
              } else {
                $resultMsg.append(
                  `<br><small class="text-danger">- File <strong>${escapeHtml(eventData.filename)}</strong> failed: ${escapeHtml(eventData.error_message || "Unknown error")}</small>`,
                );
                $progressBar.addClass("bg-warning");
              }
            } else if (eventData.type === "ingestion_start") {
              $resultMsg.html(
                `Starting ingestion for <strong>${escapeHtml(eventData.ingest_type)}</strong> into collection <strong>${escapeHtml(eventData.collection_name)}</strong>...`,
              );
              $progressBar
                .css("width", `25%`)
                .attr("aria-valuenow", 25)
                .text("Processing...");
            } else if (eventData.type === "ingestion_complete") {
              const summary = eventData.summary;
              $progressBar.css("width", "100%").attr("aria-valuenow", 100);
              if (
                summary.status === "success" ||
                (summary.files_with_errors !== undefined &&
                  summary.files_with_errors === 0)
              ) {
                $progressBar.addClass("bg-success").text("Complete!");
                $resultMsg
                  .removeClass("text-muted text-danger")
                  .addClass("text-success")
                  .html(`<strong>Success!</strong> ${escapeHtml(summary.message) || "Ingestion completed."}<br>
                                           Total Files Submitted: ${summary.total_files_submitted || "N/A"}<br>
                                           Files Processed Successfully: ${summary.files_processed_successfully || "N/A"}<br>
                                           Files With Errors: ${summary.files_with_errors || 0}<br>
                                           Total Chunks Added: ${summary.total_chunks_added_to_db || 0}<br>
                                           Target Collection: ${escapeHtml(summary.collection_name)}`);
              } else {
                $progressBar
                  .addClass("bg-danger")
                  .text("Completed with Errors!");
                let errorDetailsHtml = "";
                if (
                  summary.error_messages &&
                  summary.error_messages.length > 0
                ) {
                  errorDetailsHtml = "<br>Details:<ul>";
                  summary.error_messages.forEach((err) => {
                    errorDetailsHtml += `<li><small>${escapeHtml(err)}</small></li>`;
                  });
                  errorDetailsHtml += "</ul>";
                }
                $resultMsg
                  .removeClass("text-muted text-success")
                  .addClass("text-danger")
                  .html(`<strong>Ingestion Completed with Errors!</strong> ${escapeHtml(summary.message) || ""}<br>
                                           Total Files Submitted: ${summary.total_files_submitted || "N/A"}<br>
                                           Files With Errors: ${summary.files_with_errors || "N/A"}<br>
                                           Total Chunks Added: ${summary.total_chunks_added_to_db || 0}
                                           ${errorDetailsHtml}`);
              }
              // fetchAndPopulateRagCollections is defined in rag_ui.js
              if (typeof fetchAndPopulateRagCollections === "function") {
                fetchAndPopulateRagCollections();
              }
              setTimeout(() => $progressContainer.fadeOut(), 3000);
            } else if (eventData.type === "error") {
              throw new Error(eventData.error);
            } else if (eventData.type === "end") {
              console.log(
                "INGEST_UI: SSE stream 'end' event received from server for ingestion.",
              );
              if (
                $progressBar.text() !== "Complete!" &&
                $progressBar.text() !== "Completed with Errors!" &&
                $progressBar.text() !== "Failed!"
              ) {
                $progressBar
                  .css("width", "100%")
                  .addClass("bg-warning")
                  .text("Finished.");
                $resultMsg.append(
                  "<br><small>Ingestion process ended.</small>",
                );
                setTimeout(() => $progressContainer.fadeOut(), 3000);
              }
            }
          } catch (e) {
            console.warn(
              "INGEST_UI: Error parsing SSE event data for ingestion:",
              e,
              "Line:",
              line,
            );
          }
        }
      }
    }
  } catch (error) {
    console.error(`INGEST_UI: Ingestion error (Type: ${ingestType}):`, error);
    $progressBar.css("width", "100%").addClass("bg-danger").text("Failed!");
    $resultMsg
      .removeClass("text-muted text-success")
      .addClass("text-danger")
      .html(
        `<strong>Error!</strong> Failed to ingest data: ${escapeHtml(error.message)}`,
      );
    setTimeout(() => $progressContainer.fadeOut(), 3000);
  }
}

/**
 * Initializes event listeners for data ingestion controls.
 */
function initIngestionEventListeners() {
  $("#btn-ingest-data").on("click", function () {
    var ingestionModal = new bootstrap.Modal(
      document.getElementById("ingestionModal"),
    );
    // Reset forms and messages within the modal
    $("#form-ingest-file")[0].reset();
    $("#form-ingest-dir")[0].reset();
    $("#form-ingest-git")[0].reset();
    $("#ingestion-result-message")
      .empty()
      .addClass("text-muted")
      .text("Ingestion progress will appear here...");
    $("#ingestion-progress-bar")
      .css("width", "0%")
      .attr("aria-valuenow", 0)
      .text("");
    $("#ingestion-progress-container").hide();
    ingestionModal.show();
  });

  $("#form-ingest-file").on("submit", function (e) {
    e.preventDefault();
    const files = $("#ingest-file-input")[0].files;
    const collectionName = $("#ingest-file-collection").val().trim();
    if (!files.length || !collectionName) {
      showToast(
        // showToast from utils.js
        "Error",
        "Please select file(s) and specify a target collection name.",
        "danger",
      );
      return;
    }
    const formData = new FormData();
    formData.append("ingest_type", "file");
    formData.append("collection_name", collectionName);
    for (let i = 0; i < files.length; i++) {
      formData.append("files[]", files[i]);
    }
    handleIngestionFormSubmit("file", formData);
  });

  $("#form-ingest-dir").on("submit", function (e) {
    e.preventDefault();
    const zipFile = $("#ingest-dir-zip-input")[0].files[0];
    const collectionName = $("#ingest-dir-collection").val().trim();
    const repoName = $("#ingest-dir-repo-name").val().trim() || null;
    if (!zipFile || !collectionName) {
      showToast(
        // showToast from utils.js
        "Error",
        "Please select a ZIP file and specify a target collection name.",
        "danger",
      );
      return;
    }
    const formData = new FormData();
    formData.append("ingest_type", "dir_zip");
    formData.append("collection_name", collectionName);
    formData.append("zip_file", zipFile);
    if (repoName) formData.append("repo_name", repoName);
    handleIngestionFormSubmit("dir_zip", formData);
  });

  $("#form-ingest-git").on("submit", function (e) {
    e.preventDefault();
    const gitUrl = $("#ingest-git-url").val().trim();
    const collectionName = $("#ingest-git-collection").val().trim();
    const repoName = $("#ingest-git-repo-name").val().trim();
    const gitRef = $("#ingest-git-ref").val().trim() || null;
    if (!gitUrl || !collectionName || !repoName) {
      showToast(
        // showToast from utils.js
        "Error",
        "Please provide Git URL, Target Collection, and Repository Identifier.",
        "danger",
      );
      return;
    }
    const formData = new FormData();
    formData.append("ingest_type", "git");
    formData.append("git_url", gitUrl);
    formData.append("collection_name", collectionName);
    formData.append("repo_name", repoName);
    if (gitRef) formData.append("git_ref", gitRef);
    handleIngestionFormSubmit("git", formData);
  });
  console.log("Ingestion UI event listeners initialized.");
}
