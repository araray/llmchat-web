/**
 * @file ingestion_ui.js
 * @description Handles UI logic for the data ingestion modal, including form submissions
 * and task polling for file, directory (ZIP), and Git repository ingestion.
 * Depends on utils.js for helper functions (escapeHtml, showToast) and
 * rag_ui.js for fetchAndPopulateRagCollections.
 */

/**
 * Handles the submission of ingestion forms using the new async task-based approach.
 * Uses fetch to submit the task and then polls for status updates.
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
    .text("Submitting ingestion request...");
  $progressContainer.show();
  $progressBar
    .css("width", "0%")
    .removeClass("bg-success bg-danger")
    .attr("aria-valuenow", 0)
    .text("Starting...");

  try {
    // Submit the ingestion task
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

    const responseData = await response.json();
    const taskId = responseData.task_id;

    if (!taskId) {
      throw new Error("No task ID received from server");
    }

    console.log(`INGEST_UI: Received task ID: ${taskId}`);

    // Update UI to show task was submitted
    $resultMsg.html(
      `Task submitted successfully! <br><small>Task ID: ${escapeHtml(taskId)}</small><br>Monitoring progress...`,
    );
    $progressBar
      .css("width", "10%")
      .attr("aria-valuenow", 10)
      .text("Task submitted...");

    // Start polling for task status
    await pollTaskStatus(taskId);
  } catch (error) {
    console.error(`INGEST_UI: Ingestion error (Type: ${ingestType}):`, error);
    $progressBar.css("width", "100%").addClass("bg-danger").text("Failed!");
    $resultMsg
      .removeClass("text-muted text-success")
      .addClass("text-danger")
      .html(
        `<strong>Error!</strong> Failed to submit ingestion task: ${escapeHtml(error.message)}`,
      );
    setTimeout(() => $progressContainer.fadeOut(), 3000);
  }
}

/**
 * Polls the task status endpoint until the task is complete.
 * @param {string} taskId - The unique identifier of the task to monitor.
 */
async function pollTaskStatus(taskId) {
  const $resultMsg = $("#ingestion-result-message");
  const $progressBar = $("#ingestion-progress-bar");
  const $progressContainer = $("#ingestion-progress-container");

  const maxPollAttempts = 120; // 10 minutes with 5-second intervals
  let pollAttempts = 0;
  let pollInterval;

  try {
    pollInterval = setInterval(async () => {
      pollAttempts++;

      try {
        // Get task status
        const statusResponse = await fetch(`/api/ingest/task/${taskId}/status`);

        if (!statusResponse.ok) {
          throw new Error(`Status check failed: ${statusResponse.status}`);
        }

        const statusData = await statusResponse.json();
        const status = statusData.status;

        console.log(`INGEST_UI: Task ${taskId} status: ${status}`);

        // Update progress bar based on status
        if (status === "queued") {
          $progressBar
            .css("width", "20%")
            .attr("aria-valuenow", 20)
            .text("Queued...");
          $resultMsg.html(
            `Task queued for processing...<br><small>Task ID: ${escapeHtml(taskId)}</small>`,
          );
        } else if (status === "in_progress") {
          $progressBar
            .css("width", "50%")
            .attr("aria-valuenow", 50)
            .text("Processing...");
          $resultMsg.html(
            `Ingestion in progress...<br><small>Task ID: ${escapeHtml(taskId)}</small>`,
          );
        } else if (status === "complete") {
          // Task completed, get the result
          clearInterval(pollInterval);
          await getTaskResult(taskId);
          return;
        } else if (status === "failed") {
          // Task failed
          clearInterval(pollInterval);
          $progressBar
            .css("width", "100%")
            .addClass("bg-danger")
            .text("Failed!");
          $resultMsg
            .removeClass("text-muted text-success")
            .addClass("text-danger")
            .html(
              `<strong>Task Failed!</strong><br>Task ID: ${escapeHtml(taskId)}`,
            );
          setTimeout(() => $progressContainer.fadeOut(), 3000);
          return;
        }

        // Check if we've exceeded maximum poll attempts
        if (pollAttempts >= maxPollAttempts) {
          clearInterval(pollInterval);
          $progressBar
            .css("width", "100%")
            .addClass("bg-warning")
            .text("Timeout");
          $resultMsg
            .removeClass("text-muted text-success")
            .addClass("text-warning")
            .html(
              `<strong>Polling timeout!</strong><br>Task may still be running.<br>Task ID: ${escapeHtml(taskId)}`,
            );
          setTimeout(() => $progressContainer.fadeOut(), 5000);
        }
      } catch (pollError) {
        console.error(`INGEST_UI: Error polling task ${taskId}:`, pollError);

        // Don't fail immediately on poll errors, retry a few times
        if (pollAttempts >= 10) {
          // Increased from 5 to 10 retries
          clearInterval(pollInterval);
          $progressBar
            .css("width", "100%")
            .addClass("bg-warning")
            .text("Connection Error");
          $resultMsg
            .removeClass("text-muted text-success")
            .addClass("text-warning")
            .html(
              `<strong>Connection error!</strong><br>Task may still be running.<br>Task ID: ${escapeHtml(taskId)}<br><small>You can manually check status later.</small>`,
            );
          setTimeout(() => $progressContainer.fadeOut(), 5000);
        }
      }
    }, 5000); // Poll every 5 seconds
  } catch (error) {
    console.error(`INGEST_UI: Error starting task polling:`, error);
    if (pollInterval) clearInterval(pollInterval);
  }
}

/**
 * Retrieves and displays the final result of a completed task.
 * @param {string} taskId - The unique identifier of the completed task.
 */
async function getTaskResult(taskId) {
  const $resultMsg = $("#ingestion-result-message");
  const $progressBar = $("#ingestion-progress-bar");
  const $progressContainer = $("#ingestion-progress-container");

  try {
    const resultResponse = await fetch(`/api/ingest/task/${taskId}/result`);

    if (!resultResponse.ok) {
      throw new Error(`Result fetch failed: ${resultResponse.status}`);
    }

    const resultData = await resultResponse.json();
    const result = resultData.result;

    console.log(`INGEST_UI: Task ${taskId} result:`, result);

    // Update UI based on result
    $progressBar.css("width", "100%").attr("aria-valuenow", 100);

    if (result.status === "success") {
      $progressBar.addClass("bg-success").text("Complete!");
      $resultMsg.removeClass("text-muted text-danger").addClass("text-success")
        .html(`<strong>Success!</strong> ${escapeHtml(result.message) || "Ingestion completed."}<br>
                     Total Files Submitted: ${result.total_files_submitted || "N/A"}<br>
                     Files Processed Successfully: ${result.files_processed_successfully || "N/A"}<br>
                     Files With Errors: ${result.files_with_errors || 0}<br>
                     Total Chunks Added: ${result.total_chunks_added_to_db || 0}<br>
                     Target Collection: ${escapeHtml(result.collection_name || "")}`);
    } else {
      $progressBar.addClass("bg-danger").text("Completed with Errors!");
      let errorDetailsHtml = "";
      if (result.error_messages && result.error_messages.length > 0) {
        errorDetailsHtml = "<br>Details:<ul>";
        result.error_messages.forEach((err) => {
          errorDetailsHtml += `<li><small>${escapeHtml(err)}</small></li>`;
        });
        errorDetailsHtml += "</ul>";
      }
      $resultMsg.removeClass("text-muted text-success").addClass("text-danger")
        .html(`<strong>Ingestion Completed with Errors!</strong> ${escapeHtml(result.message) || ""}<br>
                     Total Files Submitted: ${result.total_files_submitted || "N/A"}<br>
                     Files With Errors: ${result.files_with_errors || "N/A"}<br>
                     Total Chunks Added: ${result.total_chunks_added_to_db || 0}
                     ${errorDetailsHtml}`);
    }

    // Refresh RAG collections if available
    if (typeof fetchAndPopulateRagCollections === "function") {
      fetchAndPopulateRagCollections();
    }

    setTimeout(() => $progressContainer.fadeOut(), 5000);
  } catch (error) {
    console.error(`INGEST_UI: Error getting task result for ${taskId}:`, error);
    $progressBar
      .css("width", "100%")
      .addClass("bg-warning")
      .text("Result Error");
    $resultMsg
      .removeClass("text-muted text-success")
      .addClass("text-warning")
      .html(
        `<strong>Completed but couldn't retrieve details!</strong><br>Task ID: ${escapeHtml(taskId)}`,
      );
    setTimeout(() => $progressContainer.fadeOut(), 5000);
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

  console.log(
    "Ingestion UI event listeners initialized with async task polling.",
  );
}
