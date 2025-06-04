# llmchat_web/routes/rag_routes.py
"""
Flask routes for Retrieval Augmented Generation (RAG) functionalities
in the llmchat-web application. Handles listing RAG collections,
updating session-specific RAG settings, and performing direct RAG searches.
"""
import logging
import json # For parsing JSON in rag_filter if needed, though client sends object
from typing import Any, Dict, List, Optional # Added Optional for type hinting

from flask import jsonify, request
from flask import session as flask_session

# Import the specific blueprint defined in the routes package's __init__.py
from . import rag_bp

# Import shared components from the main app module (llmchat_web.app)
from ..app import (
    llmcore_instance,
    async_to_sync_in_flask,
    logger as app_logger # Main app logger
)

# Import specific LLMCore exceptions and models relevant to RAG
from llmcore import (
    LLMCoreError, VectorStorageError,
    ContextDocument as LLMCoreContextDocument # For RAG search results
)

# Configure a local logger for this specific routes module
logger = logging.getLogger("llmchat_web.routes.rag")
if not logger.handlers and app_logger:
    logger.parent = logging.getLogger("llmchat_web.routes")
    if logger.parent and logger.parent.level:
        logger.setLevel(logger.parent.level)
    else:
        logger.setLevel(app_logger.level if app_logger else logging.DEBUG)


# --- RAG Settings and Search API Endpoints ---
# rag_bp has url_prefix='/api/rag'.

@rag_bp.route("/collections", methods=["GET"])
@async_to_sync_in_flask
async def get_rag_collections_route() -> Any:
    """
    Lists available RAG collections from LLMCore's vector store.
    Accessible at GET /api/rag/collections.
    """
    if not llmcore_instance:
        logger.error("Attempted to list RAG collections, but LLM service is not available.")
        return jsonify({"error": "LLM service not available."}), 503
    try:
        logger.debug("Fetching RAG collections from LLMCore.")
        collections = await llmcore_instance.list_rag_collections()
        logger.info(f"Successfully listed {len(collections)} RAG collections.")
        return jsonify(collections)
    except VectorStorageError as e_vs:
        logger.error(f"VectorStorageError listing RAG collections: {e_vs}", exc_info=True)
        return jsonify({"error": f"Failed to access RAG collections storage: {str(e_vs)}"}), 500
    except LLMCoreError as e: # Broader LLMCore error
        logger.error(f"LLMCoreError listing RAG collections: {e}", exc_info=True)
        return jsonify({"error": f"Failed to list RAG collections: {str(e)}"}), 500
    except Exception as e_unexp: # Catch-all for truly unexpected issues
        logger.error(f"Unexpected error listing RAG collections: {e_unexp}", exc_info=True)
        return jsonify({"error": "An unexpected server error occurred while listing RAG collections."}), 500


@rag_bp.route("/settings/update", methods=["POST"])
def update_rag_settings_route() -> Any:
    """
    Updates RAG settings (enabled, collectionName, kValue, filter) in the Flask session.
    Accessible at POST /api/rag/settings/update.
    Expects JSON payload:
    {
        "enabled": boolean,
        "collectionName": "string_or_null",
        "kValue": integer,
        "filter": "json_object_or_null"
    }
    """
    data = request.json
    if not data:
        logger.warning("Update RAG settings called with no JSON data.")
        return jsonify({"error": "No data provided."}), 400

    # Update Flask session with values from request, falling back to existing session values if not provided
    flask_session['rag_enabled'] = data.get('enabled', flask_session.get('rag_enabled', False))
    flask_session['rag_collection_name'] = data.get('collectionName', flask_session.get('rag_collection_name'))
    flask_session['rag_k_value'] = data.get('kValue', flask_session.get('rag_k_value', 3))

    # Handle RAG filter: client sends a JSON object or null.
    # Store as dict or None in session.
    filter_input = data.get('filter')
    if isinstance(filter_input, dict) and filter_input: # Non-empty dictionary
        flask_session['rag_filter'] = filter_input
    elif filter_input is None or (isinstance(filter_input, dict) and not filter_input): # Explicitly null or empty dict
        flask_session['rag_filter'] = None
    else:
        # If filter_input is something else (e.g., a string that's not valid JSON, though client should send obj/null)
        logger.warning(f"Received RAG filter of unexpected type or structure: {filter_input}. Storing None.")
        flask_session['rag_filter'] = None # Default to None if input is not a valid dict or explicit null

    flask_session.modified = True # Ensure session is saved

    logger.info(f"Flask session RAG settings updated: Enabled={flask_session['rag_enabled']}, "
                f"Collection={flask_session['rag_collection_name']}, K={flask_session['rag_k_value']}, "
                f"Filter={flask_session['rag_filter']}")

    return jsonify({
        "message": "RAG settings updated in session.",
        "rag_settings": {
            "enabled": flask_session['rag_enabled'],
            "collection_name": flask_session['rag_collection_name'],
            "k_value": flask_session['rag_k_value'],
            "filter": flask_session['rag_filter'], # Return the processed filter (dict or None)
        }
    })


@rag_bp.route("/direct_search", methods=["POST"])
@async_to_sync_in_flask
async def direct_rag_search_route() -> Any:
    """
    Performs a direct RAG search (similarity search) against a specified collection
    using LLMCore. Uses RAG settings from Flask session as defaults if not provided in request.
    Accessible at POST /api/rag/direct_search.
    Expects JSON payload:
    {
        "query": "search_query_text",
        "collection_name": "optional_collection_name",
        "k": "optional_k_value",
        "filter": "optional_filter_object_or_null"
    }
    """
    if not llmcore_instance:
        logger.error("Attempted direct RAG search, but LLM service is not available.")
        return jsonify({"error": "LLM service not available."}), 503

    data = request.json
    if not data or "query" not in data:
        logger.warning("Direct RAG search called without 'query' in JSON payload.")
        return jsonify({"error": "Missing 'query' in request."}), 400

    query: str = data["query"]
    # Use request values if provided, else fallback to Flask session values
    collection_name: Optional[str] = data.get("collection_name", flask_session.get('rag_collection_name'))
    k_value_str: Any = data.get("k", flask_session.get('rag_k_value', 3)) # k can be int or str
    # Filter from request, fallback to session. Client sends object or null.
    metadata_filter: Optional[Dict[str, Any]] = data.get("filter", flask_session.get('rag_filter'))


    if not collection_name:
        # Try to get LLMCore's configured default if not in session or request
        default_llmcore_collection = llmcore_instance.config.get("storage.vector.default_collection") if llmcore_instance.config else None
        if not default_llmcore_collection:
            logger.warning("Direct RAG search: No collection specified and no default LLMCore collection configured.")
            return jsonify({"error": "No RAG collection specified and no default LLMCore collection configured."}), 400
        collection_name = default_llmcore_collection
        logger.info(f"No collection specified for direct RAG search, using LLMCore default: {collection_name}")

    try:
        k_value = int(k_value_str) # Ensure k is an integer
        if k_value <= 0:
            logger.warning(f"Invalid K value for direct RAG search: {k_value}. Must be positive.")
            return jsonify({"error": "K value for search must be a positive integer."}), 400
    except (ValueError, TypeError):
        logger.warning(f"Invalid K value for direct RAG search: '{k_value_str}'. Defaulting to 3.")
        k_value = 3 # Default to a sensible value if parsing fails

    logger.info(f"Performing direct RAG search: Query='{query[:50]}...', Collection='{collection_name}', K={k_value}, Filter={metadata_filter}")

    try:
        search_results: List[LLMCoreContextDocument] = await llmcore_instance.search_vector_store(
            query=query,
            k=k_value,
            collection_name=collection_name,
            filter_metadata=metadata_filter # Pass filter as is (dict or None)
        )
        results_dict_list = [doc.model_dump(mode="json") for doc in search_results]
        logger.info(f"Direct RAG search completed. Found {len(results_dict_list)} results for query '{query[:50]}...' in collection '{collection_name}'.")
        return jsonify(results_dict_list)
    except (VectorStorageError, LLMCoreError) as e:
        logger.error(f"Error during direct RAG search for query '{query[:50]}...' in '{collection_name}': {e}", exc_info=True)
        return jsonify({"error": f"Direct RAG search failed: {str(e)}"}), 500
    except Exception as e_unexp: # Catch-all for other unexpected errors
        logger.error(f"Unexpected error during direct RAG search for query '{query[:50]}...' in '{collection_name}': {e_unexp}", exc_info=True)
        return jsonify({"error": "An unexpected server error occurred during RAG search."}), 500

logger.info("RAG routes (collections, settings/update, direct_search) defined on rag_bp.")
