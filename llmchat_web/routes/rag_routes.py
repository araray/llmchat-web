# llmchat_web/routes/rag_routes.py
"""
Flask routes for RAG functionalities.
"""
import logging
from flask import jsonify, request
from flask import session as flask_session
from . import rag_bp
from ..app import async_to_sync_in_flask, logger as app_logger
from ..services import get_api_client

logger = logging.getLogger("llmchat_web.routes.rag")
if not logger.handlers and app_logger:
    logger.parent = logging.getLogger("llmchat_web.routes")

@rag_bp.route("/collections", methods=["GET"])
def get_rag_collections_route():
    logger.info("RAG collections requested - returning stubbed response")
    return jsonify([])

@rag_bp.route("/settings/update", methods=["POST"])
def update_rag_settings_route():
    data = request.json or {}
    flask_session['rag_enabled'] = data.get('enabled', flask_session.get('rag_enabled', False))
    flask_session['rag_collection_name'] = data.get('collectionName', flask_session.get('rag_collection_name'))
    flask_session['rag_k_value'] = data.get('kValue', flask_session.get('rag_k_value', 3))
    flask_session['rag_filter'] = data.get('filter', flask_session.get('rag_filter'))
    flask_session.modified = True

    logger.info("RAG settings updated in Flask session")
    return jsonify({
        "message": "RAG settings updated in session.",
        "rag_settings": {
            "enabled": flask_session['rag_enabled'],
            "collection_name": flask_session['rag_collection_name'],
            "k_value": flask_session['rag_k_value'],
            "filter": flask_session['rag_filter'],
        }
    })

@rag_bp.route("/direct_search", methods=["POST"])
@async_to_sync_in_flask
async def direct_rag_search_route():
    """
    Perform a direct semantic search against the llmcore memory system.

    --- Rationale Block ---
    Pre-state: Returned a 501 stub response indicating feature not implemented
    Limitation: Users had no way to directly search RAG collections to explore content
    Decision Path: Implement as an async proxy to llmcore's /api/v2/memory/semantic/search
                   endpoint, extracting parameters from POST JSON and calling new API client method
    Post-state: Users can now perform live semantic searches and view results in modal
    """
    try:
        # Validate request data
        data = request.json or {}
        query = data.get('query', '').strip()

        if not query:
            logger.warning("Direct RAG search called without query parameter")
            return jsonify({"error": "Query parameter is required and cannot be empty"}), 400

        # Extract search parameters
        collection_name = data.get('collection_name')
        k = data.get('k', 3)
        filter_metadata = data.get('filter')

        # Validate k parameter
        if not isinstance(k, int) or k < 1 or k > 20:
            logger.warning(f"Invalid k value: {k}. Must be integer between 1 and 20")
            k = 3  # Use default instead of failing

        logger.info(f"Performing direct RAG search: query='{query[:50]}...', collection='{collection_name}', k={k}")

        # Get API client and perform search
        api_client = get_api_client()
        search_results = await api_client.search_semantic_memory(
            query=query,
            collection_name=collection_name,
            k=k,
            filter_metadata=filter_metadata
        )

        logger.info(f"Direct RAG search completed successfully: found {len(search_results)} results")
        return jsonify(search_results)

    except Exception as e:
        error_msg = str(e).lower()
        logger.error(f"Error in direct RAG search: {e}", exc_info=True)

        # Handle specific error types with appropriate HTTP status codes
        if "collection not found" in error_msg or ("collection" in error_msg and "not found" in error_msg):
            return jsonify({
                "error": f"Collection '{data.get('collection_name', 'unknown')}' not found"
            }), 404
        elif "connection" in error_msg or "timeout" in error_msg:
            return jsonify({
                "error": "Unable to connect to search service. Please try again later."
            }), 503
        elif "authentication" in error_msg or "authorization" in error_msg:
            return jsonify({
                "error": "Authentication failed with search service"
            }), 401
        else:
            return jsonify({
                "error": f"Search failed: {str(e)}"
            }), 500

logger.info("RAG routes defined on rag_bp (Direct RAG search now implemented).")
