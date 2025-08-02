# llmchat_web/routes/preset_routes.py
"""
Flask routes for managing Context Presets (also referred to as Prompt Presets).

This module provides a RESTful API for CRUD (Create, Read, Update, Delete)
operations on context presets, leveraging the llmcore API service through
the LLMCoreAPIClient. These presets allow users to save, load, and manage
reusable collections of context items for their chat sessions.

UPDATED: Refactored to use LLMCoreAPIClient instead of direct llmcore library
imports, enabling complete architectural decoupling as specified in the
service-oriented architecture transition.
"""

import logging
from typing import Any, Dict

import httpx
from flask import jsonify, request

from ..app import async_to_sync_in_flask, logger as app_logger
from ..services.llmcore_api_client import get_api_client
from . import preset_bp

# Configure a local logger for this specific routes module
logger = logging.getLogger("llmchat_web.routes.presets")
if not logger.handlers and app_logger:
    logger.parent = logging.getLogger("llmchat_web.routes")
    if logger.parent and logger.parent.level:
        logger.setLevel(logger.parent.level)
    else:
        logger.setLevel(app_logger.level if app_logger else logging.DEBUG)


@preset_bp.route("", methods=["GET"])
@async_to_sync_in_flask
async def list_presets_route() -> Any:
    """
    Retrieves a list of all saved context presets.

    Returns:
        JSON response with a list of preset metadata (name, description, etc.),
        or an error message.
    """
    api_client = get_api_client()

    try:
        presets_meta = await api_client.list_presets()
        logger.info(f"Successfully listed {len(presets_meta)} context presets via API.")
        return jsonify(presets_meta)
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 503:
            logger.error("LLM service unavailable for listing presets.")
            return jsonify({"error": "LLM service not available."}), 503
        logger.error(f"HTTP error listing context presets: {e}", exc_info=True)
        return jsonify({"error": f"Failed to list presets: {str(e)}"}), 500
    except Exception as e:
        logger.error(f"Unexpected error listing context presets: {e}", exc_info=True)
        return jsonify({"error": f"Failed to list presets: {str(e)}"}), 500


@preset_bp.route("", methods=["POST"])
@async_to_sync_in_flask
async def create_preset_route() -> Any:
    """
    Creates a new context preset.

    Expects a JSON payload with "name", "description", and "items".
    Each item in the "items" list should be a dictionary corresponding to
    the ContextPresetItem model structure.

    Returns:
        JSON response with the data of the created preset or an error message.
    """
    api_client = get_api_client()

    data = request.json
    if not data or "name" not in data or "items" not in data:
        return jsonify({
            "error": "Missing required fields: 'name' and 'items'."
        }), 400

    try:
        new_preset = await api_client.create_preset(payload=data)
        logger.info(f"Successfully created context preset '{data['name']}' via API.")
        return jsonify(new_preset), 201
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 503:
            logger.error("LLM service unavailable for creating preset.")
            return jsonify({"error": "LLM service not available."}), 503
        elif e.response.status_code == 400:
            logger.warning(f"Bad request creating preset '{data.get('name')}': {e}")
            return jsonify({"error": f"Invalid preset data: {str(e)}"}), 400
        logger.error(f"HTTP error creating context preset '{data.get('name')}': {e}", exc_info=True)
        return jsonify({"error": f"Failed to create preset: {str(e)}"}), 500
    except Exception as e:
        logger.error(f"Unexpected error creating context preset '{data.get('name')}': {e}", exc_info=True)
        return jsonify({"error": f"Failed to create preset: {str(e)}"}), 500


@preset_bp.route("/<path:preset_name>", methods=["GET"])
@async_to_sync_in_flask
async def get_preset_route(preset_name: str) -> Any:
    """
    Retrieves a single, complete context preset by its name.

    Args:
        preset_name: The name of the preset to retrieve.

    Returns:
        JSON response with the full preset data or a 404 error if not found.
    """
    api_client = get_api_client()

    try:
        preset = await api_client.get_preset(preset_name)
        logger.info(f"Successfully loaded context preset '{preset_name}' via API.")
        return jsonify(preset)
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            logger.warning(f"Context preset '{preset_name}' not found.")
            return jsonify({"error": "Preset not found."}), 404
        elif e.response.status_code == 503:
            logger.error("LLM service unavailable for getting preset.")
            return jsonify({"error": "LLM service not available."}), 503
        logger.error(f"HTTP error loading context preset '{preset_name}': {e}", exc_info=True)
        return jsonify({"error": f"Failed to load preset: {str(e)}"}), 500
    except Exception as e:
        logger.error(f"Unexpected error loading context preset '{preset_name}': {e}", exc_info=True)
        return jsonify({"error": f"Failed to load preset: {str(e)}"}), 500


@preset_bp.route("/<path:preset_name>", methods=["PUT"])
@async_to_sync_in_flask
async def update_preset_route(preset_name: str) -> Any:
    """
    Updates an existing context preset.

    This acts as an "upsert" operation. It overwrites the existing preset
    with the provided data. The preset name in the URL must match the name
    in the payload.

    Args:
        preset_name: The name of the preset to update.

    Returns:
        JSON response with the updated preset data or an error message.
    """
    api_client = get_api_client()

    data = request.json
    if (not data or "name" not in data or "items" not in data or
            data["name"] != preset_name):
        return jsonify({
            "error":
            "Payload must include 'name' and 'items', and name must match URL."
        }), 400

    try:
        updated_preset = await api_client.update_preset(preset_name, payload=data)
        logger.info(f"Successfully updated context preset '{preset_name}' via API.")
        return jsonify(updated_preset)
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            logger.warning(f"Context preset '{preset_name}' not found for update.")
            return jsonify({"error": "Preset not found."}), 404
        elif e.response.status_code == 503:
            logger.error("LLM service unavailable for updating preset.")
            return jsonify({"error": "LLM service not available."}), 503
        elif e.response.status_code == 400:
            logger.warning(f"Bad request updating preset '{preset_name}': {e}")
            return jsonify({"error": f"Invalid preset data: {str(e)}"}), 400
        logger.error(f"HTTP error updating context preset '{preset_name}': {e}", exc_info=True)
        return jsonify({"error": f"Failed to update preset: {str(e)}"}), 500
    except Exception as e:
        logger.error(f"Unexpected error updating context preset '{preset_name}': {e}", exc_info=True)
        return jsonify({"error": f"Failed to update preset: {str(e)}"}), 500


@preset_bp.route("/<path:preset_name>", methods=["DELETE"])
@async_to_sync_in_flask
async def delete_preset_route(preset_name: str) -> Any:
    """
    Deletes a context preset by its name.

    Args:
        preset_name: The name of the preset to delete.

    Returns:
        JSON response confirming deletion or an error message.
    """
    api_client = get_api_client()

    try:
        await api_client.delete_preset(preset_name)
        logger.info(f"Successfully deleted context preset '{preset_name}' via API.")
        return jsonify({
            "message": f"Preset '{preset_name}' deleted successfully."
        })
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            logger.warning(f"Context preset '{preset_name}' not found for deletion.")
            return jsonify({"error": "Preset not found."}), 404
        elif e.response.status_code == 503:
            logger.error("LLM service unavailable for deleting preset.")
            return jsonify({"error": "LLM service not available."}), 503
        logger.error(f"HTTP error deleting context preset '{preset_name}': {e}", exc_info=True)
        return jsonify({"error": f"Failed to delete preset: {str(e)}"}), 500
    except Exception as e:
        logger.error(f"Unexpected error deleting context preset '{preset_name}': {e}", exc_info=True)
        return jsonify({"error": f"Failed to delete preset: {str(e)}"}), 500


@preset_bp.route("/<path:old_name>/rename", methods=["POST"])
@async_to_sync_in_flask
async def rename_preset_route(old_name: str) -> Any:
    """
    Renames a context preset.

    Args:
        old_name: The current name of the preset.

    JSON Payload:
        new_name (str): The new name for the preset.

    Returns:
        JSON response confirming the rename or an error message.
    """
    api_client = get_api_client()

    data = request.json
    if not data or "new_name" not in data or not data["new_name"].strip():
        return jsonify({
            "error": "Request payload must include a non-empty 'new_name'."
        }), 400

    new_name = data["new_name"].strip()
    try:
        result = await api_client.rename_preset(old_name, new_name)
        logger.info(f"Successfully renamed preset '{old_name}' to '{new_name}' via API.")
        # Return the result from the API, which should contain a success message
        return jsonify(result)
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            logger.warning(f"Failed to rename preset '{old_name}'. It might not exist.")
            return jsonify({
                "error":
                f"Failed to rename preset '{old_name}'. The preset may not exist, or the new name '{new_name}' may already be in use."
            }), 404
        elif e.response.status_code == 503:
            logger.error("LLM service unavailable for renaming preset.")
            return jsonify({"error": "LLM service not available."}), 503
        elif e.response.status_code == 400:
            logger.warning(f"Bad request renaming preset '{old_name}' to '{new_name}': {e}")
            return jsonify({"error": f"Invalid rename request: {str(e)}"}), 400
        logger.error(f"HTTP error renaming preset '{old_name}' to '{new_name}': {e}", exc_info=True)
        return jsonify({"error": f"Failed to rename preset: {str(e)}"}), 500
    except Exception as e:
        logger.error(f"Unexpected error renaming preset '{old_name}' to '{new_name}': {e}", exc_info=True)
        return jsonify({"error": f"Failed to rename preset: {str(e)}"}), 500


logger.info("Context Preset routes defined on preset_bp (API-driven implementation).")
