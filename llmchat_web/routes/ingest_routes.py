# llmchat_web/routes/ingest_routes.py
"""
Flask routes for data ingestion functionalities in the llmchat-web application.
Handles ingestion of files, directories (via ZIP), and Git repositories
into RAG collections using Apykatu and LLMCore.
"""
import asyncio
import json
import logging
import tempfile
import shutil # For removing temporary directories if needed, though TemporaryDirectory handles it
import zipfile
from pathlib import Path
from typing import Any, AsyncGenerator, Dict, List, Optional

from flask import Response, request, stream_with_context
from werkzeug.utils import secure_filename

# Import the specific blueprint defined in the routes package's __init__.py
from . import ingest_bp

# Import shared components from the main app module (llmchat_web.app)
from ..app import (
    llmcore_instance,
    run_async_generator_synchronously, # Shared utility for streaming
    logger as app_logger # Main app logger
)

# Attempt to import Apykatu and GitPython for ingestion
APYKATU_AVAILABLE = False
GITPYTHON_AVAILABLE = False
ApykatuAppConfig = None
IngestionPipeline = None
apykatu_process_file_path_api = None
ApykatuConfigError = None
ApykatuProcessedChunk = None # type: ignore
ApykatuProcessingStats = None # type: ignore
git = None # type: ignore

try:
    from apykatu.pipelines.ingest import IngestionPipeline as ApykatuIngestionPipeline
    from apykatu.api import process_file_path as apykatu_api_process_file_path
    from apykatu.config.models import AppConfig as PyApykatuAppConfig
    from apykatu.config.models import ConfigError as PyApykatuConfigError
    from apykatu.api_models import ProcessedChunk as PyApykatuProcessedChunk
    from apykatu.api_models import ProcessingStats as PyApykatuProcessingStats
    APYKATU_AVAILABLE = True
    ApykatuAppConfig = PyApykatuAppConfig
    IngestionPipeline = ApykatuIngestionPipeline
    apykatu_process_file_path_api = apykatu_api_process_file_path
    ApykatuConfigError = PyApykatuConfigError
    ApykatuProcessedChunk = PyApykatuProcessedChunk # type: ignore
    ApykatuProcessingStats = PyApykatuProcessingStats # type: ignore
except ImportError:
    # Logging will be done by the logger instance below
    pass # Handled by logger message

try:
    import git as pygit
    GITPYTHON_AVAILABLE = True
    git = pygit
except ImportError:
    # Logging will be done by the logger instance below
    pass # Handled by logger message


# Configure a local logger for this specific routes module
logger = logging.getLogger("llmchat_web.routes.ingest")
if not logger.handlers and app_logger:
    logger.parent = logging.getLogger("llmchat_web.routes")
    if logger.parent and logger.parent.level:
        logger.setLevel(logger.parent.level)
    else:
        logger.setLevel(app_logger.level if app_logger else logging.DEBUG)

if not APYKATU_AVAILABLE:
    logger.warning("Apykatu library not found. Ingestion features will be disabled.")
    # Define dummy/placeholder types if Apykatu is not available to prevent NameErrors
    if ApykatuAppConfig is None: ApykatuAppConfig = type('ApykatuAppConfig', (object,), {}) # type: ignore
    if IngestionPipeline is None:
        class IngestionPipeline: # type: ignore
            def __init__(self, *args: Any, **kwargs: Any) -> None: pass
            async def run(self, *args: Any, **kwargs: Any) -> None: pass
    if apykatu_process_file_path_api is None: async def apykatu_process_file_path_api(*args: Any, **kwargs: Any) -> Any: return ([], type('Stats', (object,), {'error_messages': ['Apykatu not available']})()) # type: ignore
    if ApykatuConfigError is None: ApykatuConfigError = type('ApykatuConfigError', (Exception,), {}) # type: ignore
    if ApykatuProcessedChunk is None: ApykatuProcessedChunk = type('ApykatuProcessedChunk', (object,), {}) # type: ignore
    if ApykatuProcessingStats is None: ApykatuProcessingStats = type('ApykatuProcessingStats', (object,), {}) # type: ignore


if not GITPYTHON_AVAILABLE:
    logger.warning("GitPython library not found. Git ingestion will be disabled.")
    if git is None: git = type('git', (object,), {}) # type: ignore


# --- Ingestion Helper Functions ---

def _get_apykatu_config_for_ingestion(collection_name_override: str) -> Optional[Any]: # Type Any for ApykatuAppConfig due to conditional import
    """
    Prepares ApykatuAppConfig for an ingestion run.
    It fetches LLMCore's [apykatu] settings from the LLMCore configuration,
    then overrides the database path and target collection name based on
    LLMCore's main vector store settings and the provided `collection_name_override`.

    Args:
        collection_name_override: The target collection name for this ingestion task.

    Returns:
        An ApykatuAppConfig object configured for the ingestion, or None if
        LLMCore, its config, Apykatu library, or Apykatu config loading fails.
    """
    if not llmcore_instance or not llmcore_instance.config:
        logger.error("LLMCore instance or its config not available for Apykatu config preparation.")
        return None
    if not APYKATU_AVAILABLE or ApykatuAppConfig is None or ApykatuConfigError is None: # Check for ApykatuConfigError too
        logger.error("Apykatu library or its core components not available for config preparation.")
        return None

    apykatu_settings_from_llmcore_raw = llmcore_instance.config.get('apykatu', {})
    apykatu_settings_from_llmcore: Dict[str, Any]
    if hasattr(apykatu_settings_from_llmcore_raw, 'as_dict'): # Check for Confy sub-config object
        apykatu_settings_from_llmcore = apykatu_settings_from_llmcore_raw.as_dict()
    elif isinstance(apykatu_settings_from_llmcore_raw, dict):
        apykatu_settings_from_llmcore = apykatu_settings_from_llmcore_raw
    else:
        logger.error(f"LLMCore's 'apykatu' config section is not a dictionary or Confy object. Type: {type(apykatu_settings_from_llmcore_raw)}")
        apykatu_settings_from_llmcore = {} # Fallback to empty dict

    logger.debug(f"Apykatu settings from LLMCore for ingestion: {apykatu_settings_from_llmcore}")

    try:
        # Apykatu's config loading mechanism (ensure it's imported if APYKATU_AVAILABLE)
        from apykatu.config.confy_loader import load_app_config_with_confy as load_apykatu_config

        # Load Apykatu's own defaults first, then apply LLMCore's overrides
        final_apykatu_config_tuple = load_apykatu_config(
            cli_config_file_path=None, # Apykatu won't load its own file
            cli_overrides=apykatu_settings_from_llmcore # Apply LLMCore's apykatu section
        )
        final_apykatu_config: Any = final_apykatu_config_tuple[0] # Type Any for ApykatuAppConfig

    except ApykatuConfigError as e_conf: # type: ignore
        logger.error(f"ApykatuConfigError during Apykatu config loading: {e_conf}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error loading Apykatu config: {e}", exc_info=True)
        return None

    # Override DB path and collection name from LLMCore's main vector store config
    llmcore_vector_db_path = llmcore_instance.config.get("storage.vector.path")
    if llmcore_vector_db_path:
        final_apykatu_config.database.path = Path(llmcore_vector_db_path).expanduser().resolve()
    else:
        logger.warning("LLMCore's storage.vector.path is not set. Apykatu will use its default DB path if not overridden elsewhere in its own config.")

    final_apykatu_config.database.collection_name = collection_name_override # Crucial override
    logger.info(f"Apykatu config prepared for ingestion. Collection: '{collection_name_override}', DB Path: '{final_apykatu_config.database.path}'")
    return final_apykatu_config


async def stream_file_ingestion_progress(uploaded_files: List[Any], collection_name: str, temp_dir: Path, apykatu_cfg: Any) -> AsyncGenerator[str, None]:
    """
    Async generator to process uploaded files one by one for ingestion and stream SSE progress.
    Each file is saved temporarily, processed by Apykatu, and its chunks are added to
    LLMCore's vector store.

    Args:
        uploaded_files: A list of Werkzeug FileStorage objects representing uploaded files.
        collection_name: The target RAG collection name.
        temp_dir: A Path object to a temporary directory for storing uploaded files during processing.
        apykatu_cfg: The ApykatuAppConfig object configured for this ingestion task.

    Yields:
        Strings formatted as SSE messages detailing the ingestion progress.
    """
    if not llmcore_instance or not apykatu_process_file_path_api or not ApykatuProcessedChunk or not ApykatuProcessingStats: # type: ignore
        logger.error("LLM service or Apykatu components not available for file ingestion stream.")
        yield f"data: {json.dumps({'type': 'error', 'error': 'LLM service or Apykatu components not available.'})}\n\n"
        yield f"data: {json.dumps({'type': 'end'})}\n\n"
        return

    total_files = len(uploaded_files)
    overall_chunks_added = 0
    overall_files_processed_successfully = 0
    overall_files_with_errors = 0
    all_error_messages: List[str] = []

    logger.info(f"Starting file ingestion stream for {total_files} files into collection '{collection_name}'. Temp dir: {temp_dir}")

    for i, uploaded_file_storage in enumerate(uploaded_files):
        filename = "unknown_file"
        file_status = "pending"
        file_error_msg: Optional[str] = None
        chunks_this_file = 0
        try:
            if not uploaded_file_storage or not uploaded_file_storage.filename:
                logger.warning(f"Skipping invalid file upload object at index {i} for collection '{collection_name}'.")
                file_error_msg = "Invalid file upload object received."
                overall_files_with_errors +=1
                all_error_messages.append(f"File {i+1}: {file_error_msg}")
                yield f"data: {json.dumps({'type': 'file_end', 'filename': 'N/A', 'file_index': i, 'total_files': total_files, 'status': 'error', 'error_message': file_error_msg, 'chunks_added': 0})}\n\n"
                await asyncio.sleep(0.01) # Ensure message is sent
                continue

            filename = secure_filename(uploaded_file_storage.filename)
            yield f"data: {json.dumps({'type': 'file_start', 'filename': filename, 'file_index': i, 'total_files': total_files})}\n\n"
            await asyncio.sleep(0.01)

            temp_file_path = temp_dir / filename
            uploaded_file_storage.save(str(temp_file_path)) # Ensure path is string for save()
            logger.info(f"Processing uploaded file ({i+1}/{total_files}): '{filename}' for collection '{collection_name}' from path '{temp_file_path}'.")

            # Call Apykatu's API to process the file
            processed_chunks_apy, api_stats_obj_apy = await apykatu_process_file_path_api( # type: ignore
                file_path=temp_file_path, config=apykatu_cfg, generate_embeddings=True
            )
            # Cast to specific types if available, for type checking benefits
            processed_chunks: List[ApykatuProcessedChunk] = processed_chunks_apy # type: ignore
            api_stats_obj: ApykatuProcessingStats = api_stats_obj_apy # type: ignore


            if api_stats_obj.error_messages:
                file_status = "error"
                file_error_msg = "; ".join(api_stats_obj.error_messages)
                all_error_messages.extend([f"File '{filename}': e" for e in api_stats_obj.error_messages])
                overall_files_with_errors +=1
                logger.warning(f"Errors processing file '{filename}' with Apykatu: {file_error_msg}")
            else:
                if processed_chunks:
                    docs_for_llmcore = []
                    for pc in processed_chunks:
                        if pc.embedding_data and pc.embedding_data.get("vector"):
                            meta_to_store = pc.metadata_from_apykatu.model_dump() if hasattr(pc.metadata_from_apykatu, 'model_dump') else pc.metadata_from_apykatu
                            docs_for_llmcore.append({
                                "id": pc.semantiscan_chunk_id,
                                "content": pc.content_text,
                                "embedding": pc.embedding_data["vector"],
                                "metadata": meta_to_store
                            })
                        else:
                            logger.warning(f"Chunk {pc.semantiscan_chunk_id} from file '{filename}' missing embedding. Skipping.")

                    if docs_for_llmcore:
                        added_ids = await llmcore_instance.add_documents_to_vector_store(
                            documents=docs_for_llmcore, # type: ignore
                            collection_name=collection_name
                        )
                        chunks_this_file = len(added_ids)
                        overall_chunks_added += chunks_this_file
                        file_status = "success"
                        overall_files_processed_successfully +=1
                        logger.info(f"Successfully added {chunks_this_file} chunks from file '{filename}' to collection '{collection_name}'.")
                    else:
                        file_status = "warning_no_chunks_with_embeddings"
                        file_error_msg = "No processable chunks with embeddings found by Apykatu."
                        overall_files_with_errors +=1 # Count as error if no chunks added
                        all_error_messages.append(f"File '{filename}': {file_error_msg}")
                        logger.warning(f"File '{filename}' produced no chunks with embeddings by Apykatu.")
                else: # No chunks produced by Apykatu
                    file_status = "warning_no_chunks_produced"
                    file_error_msg = "Apykatu processed the file but produced no chunks."
                    overall_files_with_errors +=1 # Count as error
                    all_error_messages.append(f"File '{filename}': {file_error_msg}")
                    logger.warning(f"File '{filename}' produced no chunks by Apykatu.")

            yield f"data: {json.dumps({'type': 'file_end', 'filename': filename, 'file_index': i, 'total_files': total_files, 'status': file_status, 'chunks_added': chunks_this_file, 'error_message': file_error_msg})}\n\n"
            await asyncio.sleep(0.01)

        except Exception as e_file:
            logger.error(f"Error processing file '{filename}' during ingestion stream for collection '{collection_name}': {e_file}", exc_info=True)
            file_error_msg = str(e_file)
            overall_files_with_errors +=1
            all_error_messages.append(f"File '{filename}': {file_error_msg}")
            yield f"data: {json.dumps({'type': 'file_end', 'filename': filename, 'file_index': i, 'total_files': total_files, 'status': 'error', 'error_message': file_error_msg, 'chunks_added': 0})}\n\n"
            await asyncio.sleep(0.01)
        finally:
            # Clean up individual temp file if it exists
            if 'temp_file_path' in locals() and temp_file_path.exists(): # type: ignore
                try:
                    temp_file_path.unlink() # type: ignore
                except OSError as e_unlink:
                    logger.warning(f"Could not delete temporary file {temp_file_path}: {e_unlink}") # type: ignore

    # Final summary event
    summary_status = "no_files_processed"
    if total_files > 0:
        if overall_files_with_errors == 0:
            summary_status = "success"
        elif overall_files_processed_successfully > 0:
            summary_status = "completed_with_some_errors"
        else:
            summary_status = "completed_with_all_errors"


    summary_payload = {
        "total_files_submitted": total_files,
        "files_processed_successfully": overall_files_processed_successfully,
        "files_with_errors": overall_files_with_errors,
        "total_chunks_added_to_db": overall_chunks_added,
        "collection_name": collection_name,
        "error_messages": all_error_messages,
        "status": summary_status
    }
    logger.info(f"File ingestion stream completed for collection '{collection_name}'. Summary: {summary_payload}")
    yield f"data: {json.dumps({'type': 'ingestion_complete', 'summary': summary_payload})}\n\n"
    yield f"data: {json.dumps({'type': 'end'})}\n\n" # Ensure stream ends properly


async def stream_other_ingestion_types_sse_async_gen(ingest_type: str, collection_name: str, apykatu_cfg: Any, form_data: Dict[str, Any], files_data: Dict[str, Any]) -> AsyncGenerator[str, None]:
    """
    Async generator for streaming SSE progress for directory ZIP and Git repository ingestion.
    Uses Apykatu's IngestionPipeline.

    Args:
        ingest_type: The type of ingestion ('dir_zip' or 'git').
        collection_name: The target RAG collection name.
        apykatu_cfg: The ApykatuAppConfig object.
        form_data: Dictionary of form fields from the request.
        files_data: Dictionary of uploaded files (e.g., for 'zip_file').

    Yields:
        Strings formatted as SSE messages detailing the ingestion progress.
    """
    if not llmcore_instance or not IngestionPipeline or not APYKATU_AVAILABLE:
        logger.error(f"LLM service or Apykatu IngestionPipeline not available for '{ingest_type}' ingestion.")
        yield f"data: {json.dumps({'type': 'error', 'error': f'Service or Apykatu pipeline not available for {ingest_type} ingestion.'})}\n\n"
        yield f"data: {json.dumps({'type': 'end'})}\n\n"
        return

    overall_status = "error" # Default to error
    summary_message = f"Ingestion for '{ingest_type}' started."
    details: Dict[str, Any] = {"ingest_type": ingest_type, "collection_name": collection_name}
    error_messages_list: List[str] = []

    # Use a context manager for the temporary directory
    with tempfile.TemporaryDirectory(prefix=f"llmchat_web_ingest_{ingest_type}_") as temp_dir_str:
        temp_dir_path = Path(temp_dir_str)
        logger.info(f"Starting '{ingest_type}' ingestion for collection '{collection_name}'. Temp dir: {temp_dir_path}")
        try:
            yield f"data: {json.dumps({'type': 'ingestion_start', 'ingest_type': ingest_type, 'collection_name': collection_name})}\n\n"
            await asyncio.sleep(0.01) # Ensure message is sent

            pipeline = IngestionPipeline(config=apykatu_cfg, progress_context=None) # type: ignore

            if ingest_type == "dir_zip":
                zip_file_storage = files_data.get("zip_file") # Assuming 'zip_file' is the key from request.files
                if not zip_file_storage or not zip_file_storage.filename:
                    summary_message = "No ZIP file provided for directory ingestion."
                    raise ValueError(summary_message)

                filename = secure_filename(zip_file_storage.filename)
                temp_zip_path = temp_dir_path / filename
                zip_file_storage.save(str(temp_zip_path))
                extracted_dir_path = temp_dir_path / "unzipped_content"
                extracted_dir_path.mkdir(parents=True, exist_ok=True)
                with zipfile.ZipFile(temp_zip_path, 'r') as zip_ref:
                    zip_ref.extractall(extracted_dir_path)
                logger.info(f"Extracted ZIP '{filename}' to '{extracted_dir_path}'. Starting Apykatu pipeline for collection '{collection_name}'.")

                repo_name_identifier = form_data.get("repo_name", extracted_dir_path.name) # From request.form
                # Apykatu's pipeline.run is async
                # TODO: Apykatu's IngestionPipeline.run might not return detailed stats like process_file_path_api.
                # We might need to adapt how we report success/failure counts.
                await pipeline.run(repo_path=extracted_dir_path, repo_name=repo_name_identifier, git_ref="HEAD", mode='snapshot') # type: ignore
                summary_message = f"Directory (ZIP) '{filename}' ingestion pipeline completed for collection '{collection_name}'."
                overall_status = "success" # Assume success if pipeline.run doesn't raise an exception
                details['files_processed_successfully'] = "N/A (dir)" # Placeholder, Apykatu pipeline might not provide this
                details['total_chunks_added_to_db'] = "N/A (dir)" # Placeholder

            elif ingest_type == "git":
                if not GITPYTHON_AVAILABLE or not git:
                    summary_message = "GitPython library not available for Git ingestion."
                    raise ImportError(summary_message)
                git_url = form_data.get("git_url")
                repo_name_for_git = form_data.get("repo_name") # This is the identifier, not necessarily the clone dir name
                git_ref = form_data.get("git_ref") or "HEAD"
                if not git_url or not repo_name_for_git:
                    summary_message = "Missing Git URL or repository identifier for Git ingestion."
                    raise ValueError(summary_message)

                # Use a subdirectory within temp_dir_path for cloning to keep it clean
                cloned_repo_path = temp_dir_path / secure_filename(repo_name_for_git) # Sanitize for path
                cloned_repo_path.mkdir(parents=True, exist_ok=True)

                logger.info(f"Cloning Git repo from '{git_url}' (ref: {git_ref}) to '{cloned_repo_path}' for collection '{collection_name}'.")
                # Git clone is synchronous, run in thread for async context
                await asyncio.to_thread(git.Repo.clone_from, git_url, str(cloned_repo_path), branch=git_ref if git_ref != "HEAD" else None, depth=1) # type: ignore

                logger.info(f"Git repo '{repo_name_for_git}' cloned. Starting Apykatu pipeline for collection '{collection_name}'.")
                await pipeline.run(repo_path=cloned_repo_path, repo_name=repo_name_for_git, git_ref=git_ref, mode='snapshot') # type: ignore
                summary_message = f"Git repository '{repo_name_for_git}' (ref: {git_ref}) ingestion pipeline completed for collection '{collection_name}'."
                overall_status = "success"
                details['files_processed_successfully'] = "N/A (git)"
                details['total_chunks_added_to_db'] = "N/A (git)"
            else:
                summary_message = f"Unsupported ingestion type for this streaming handler: {ingest_type}"
                raise ValueError(summary_message)

        except Exception as e_other:
            logger.error(f"Error during '{ingest_type}' ingestion stream for collection '{collection_name}': {e_other}", exc_info=True)
            summary_message = str(e_other)
            overall_status = "error"
            error_messages_list.append(summary_message)
            details['error_message'] = summary_message # Store first error for details
        # Temporary directory is cleaned up automatically by the 'with' statement

        # Construct final summary payload
        final_summary_payload = {
            "message": summary_message,
            "status": overall_status,
            "collection_name": collection_name,
            "details": details, # Contains ingest_type, collection_name, and potentially error_message
            "total_files_submitted": "N/A" if ingest_type != "file" else 0,
            "files_processed_successfully": details.get('files_processed_successfully', "N/A (summary not detailed for this type)"),
            "files_with_errors": details.get('files_with_errors', 0 if overall_status == "success" else "N/A (summary not detailed for this type)"),
            "total_chunks_added_to_db": details.get('total_chunks_added_to_db', "N/A (summary not detailed for this type)"),
            "error_messages": error_messages_list
        }
        logger.info(f"'{ingest_type}' ingestion stream completed for collection '{collection_name}'. Summary: {final_summary_payload}")
        yield f"data: {json.dumps({'type': 'ingestion_complete', 'summary': final_summary_payload})}\n\n"
        yield f"data: {json.dumps({'type': 'end'})}\n\n"


# --- Data Ingestion API Endpoint ---
# ingest_bp has url_prefix='/api/ingest'.
@ingest_bp.route("", methods=["POST"]) # Empty path for the blueprint's root
def ingest_data_route() -> Response:
    """
    Handles data ingestion requests for files, directory ZIPs, and Git URLs.
    Uses Apykatu for document processing and LLMCore for vector storage.
    Streams progress back to the client using Server-Sent Events (SSE).
    Accessible at POST /api/ingest.

    Request is expected to be 'multipart/form-data'.
    Form fields:
        - 'ingest_type': "file", "dir_zip", or "git"
        - 'collection_name': Target RAG collection name.
        - For 'file': 'files[]' (multiple file uploads)
        - For 'dir_zip': 'zip_file' (single ZIP file), 'repo_name' (optional identifier)
        - For 'git': 'git_url', 'repo_name' (identifier), 'git_ref' (optional branch/tag/commit)
    """
    if not llmcore_instance:
        def error_stream_llm_unavailable():
            yield f"data: {json.dumps({'type': 'error', 'error': 'LLM service not available.'})}\n\n"
            yield f"data: {json.dumps({'type': 'end'})}\n\n"
        return Response(stream_with_context(error_stream_llm_unavailable()), mimetype='text/event-stream')

    if not APYKATU_AVAILABLE:
        def error_stream_apykatu_unavailable():
            yield f"data: {json.dumps({'type': 'error', 'error': 'Apykatu ingestion service not available.'})}\n\n"
            yield f"data: {json.dumps({'type': 'end'})}\n\n"
        return Response(stream_with_context(error_stream_apykatu_unavailable()), mimetype='text/event-stream')

    ingest_type = request.form.get("ingest_type")
    collection_name = request.form.get("collection_name")

    if not ingest_type or not collection_name:
        logger.warning("Ingestion request missing 'ingest_type' or 'collection_name'.")
        def error_stream_missing_params():
            yield f"data: {json.dumps({'type': 'error', 'error': 'Missing ingest_type or collection_name.'})}\n\n"
            yield f"data: {json.dumps({'type': 'end'})}\n\n"
        return Response(stream_with_context(error_stream_missing_params()), status=400, mimetype='text/event-stream')

    logger.info(f"Received ingestion request. Type: {ingest_type}, Collection: {collection_name}")

    apykatu_cfg = _get_apykatu_config_for_ingestion(collection_name)
    if not apykatu_cfg:
        logger.error(f"Failed to prepare Apykatu configuration for ingestion into '{collection_name}'.")
        def error_stream_apykatu_cfg():
            yield f"data: {json.dumps({'type': 'error', 'error': 'Failed to prepare Apykatu configuration.'})}\n\n"
            yield f"data: {json.dumps({'type': 'end'})}\n\n"
        return Response(stream_with_context(error_stream_apykatu_cfg()), status=500, mimetype='text/event-stream')

    if ingest_type == "file":
        uploaded_files = request.files.getlist("files[]") # Get list of FileStorage objects
        if not uploaded_files or not any(f.filename for f in uploaded_files):
            logger.warning(f"File ingestion request for '{collection_name}' received no files.")
            def error_stream_no_files():
                yield f"data: {json.dumps({'type': 'error', 'error': 'No files provided for file ingestion.'})}\n\n"
                yield f"data: {json.dumps({'type': 'end'})}\n\n"
            return Response(stream_with_context(error_stream_no_files()), status=400, mimetype='text/event-stream')

        # Use a TemporaryDirectory that cleans itself up
        temp_dir_manager = tempfile.TemporaryDirectory(prefix="llmchat_web_ingest_files_")
        temp_dir_path = Path(temp_dir_manager.name)

        def file_ingestion_stream_generator_wrapper():
            try:
                # Pass temp_dir_path to the async generator
                for event in run_async_generator_synchronously(stream_file_ingestion_progress, uploaded_files, collection_name, temp_dir_path, apykatu_cfg):
                    yield event
            finally:
                temp_dir_manager.cleanup() # Ensure cleanup if not already done by context manager exit
                logger.info(f"Cleaned up temporary directory for file ingestion: {temp_dir_path}")

        return Response(stream_with_context(file_ingestion_stream_generator_wrapper()), mimetype='text/event-stream')

    elif ingest_type in ["dir_zip", "git"]:
        # For dir_zip and git, we pass form data and files data to the async generator
        # The async generator will handle creating its own temp directory internally using 'with'.
        form_data_dict = request.form.to_dict()
        files_data_dict = {k: v for k, v in request.files.items()} # Convert ImmutableMultiDict to dict

        sync_generator = run_async_generator_synchronously(
            stream_other_ingestion_types_sse_async_gen,
            ingest_type,
            collection_name,
            apykatu_cfg,
            form_data_dict,
            files_data_dict
        )
        return Response(stream_with_context(sync_generator), mimetype='text/event-stream')

    else:
        logger.warning(f"Unsupported ingestion type received: {ingest_type}")
        def error_stream_unsupported_type():
            yield f"data: {json.dumps({'type': 'error', 'error': f'Unsupported ingestion type: {ingest_type}.'})}\n\n"
            yield f"data: {json.dumps({'type': 'end'})}\n\n"
        return Response(stream_with_context(error_stream_unsupported_type()), status=400, mimetype='text/event-stream')

logger.info("Data ingestion routes (/api/ingest) defined on ingest_bp.")
