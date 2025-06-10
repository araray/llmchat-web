# llmchat_web/routes/preset_routes.py
"""
Flask routes for managing Context Presets (also referred to as Prompt Presets).

This module provides a RESTful API for CRUD (Create, Read, Update, Delete)
operations on context presets, leveraging the underlying functionality of the
LLMCore library. These presets allow users to save, load, and manage reusable
collections of context items for their chat sessions.
"""

import logging
from typing import Any, Dict

from flask import jsonify, request

from llmcore import (ContextPresetItem, LLMCoreError, StorageError)
from llmcore.models import ContextItemType

from ..app import async_to_sync_in_flask, llmcore_instance, logger as app_logger
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
    if not llmcore_instance:
        logger.error(
            "Attempted to list presets, but LLM service is not available."
        )
        return jsonify({"error": "LLM service not available."}), 503
    try:
        presets_meta = await llmcore_instance.list_context_presets()
        logger.info(f"Successfully listed {len(presets_meta)} context presets.")
        return jsonify(presets_meta)
    except (StorageError, LLMCoreError) as e:
        logger.error(f"Error listing context presets: {e}", exc_info=True)
        return jsonify({"error": f"Failed to list presets: {str(e)}"}), 500


@preset_bp.route("", methods=["POST"])
@async_to_sync_in_flask
async def create_preset_route() -> Any:
    """
    Creates a new context preset.

    Expects a JSON payload with "name", "description", and "items".
    Each item in the "items" list should be a dictionary corresponding to
    the ContextPresetItem model.

    Returns:
        JSON response with the data of the created preset or an error message.
    """
    if not llmcore_instance:
        logger.error(
            "Attempted to create a preset, but LLM service is not available."
        )
        return jsonify({"error": "LLM service not available."}), 503

    data = request.json
    if not data or "name" not in data or "items" not in data:
        return jsonify({
            "error": "Missing required fields: 'name' and 'items'."
        }), 400

    try:
        preset_items = [ContextPresetItem(**item) for item in data["items"]]
        new_preset = await llmcore_instance.save_context_preset(
            preset_name=data["name"],
            description=data.get("description"),
            items=preset_items,
            metadata=data.get("metadata"),
        )
        logger.info(f"Successfully created context preset '{new_preset.name}'.")
        return jsonify(new_preset.model_dump(mode="json")), 201
    except (StorageError, LLMCoreError, ValueError) as e:
        logger.error(
            f"Error creating context preset '{data.get('name')}': {e}",
            exc_info=True)
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
    if not llmcore_instance:
        logger.error(
            f"Attempted to get preset '{preset_name}', but LLM service is not available."
        )
        return jsonify({"error": "LLM service not available."}), 503
    try:
        preset = await llmcore_instance.load_context_preset(preset_name)
        if preset:
            logger.info(f"Successfully loaded context preset '{preset_name}'.")
            return jsonify(preset.model_dump(mode="json"))
        else:
            logger.warning(f"Context preset '{preset_name}' not found.")
            return jsonify({"error": "Preset not found."}), 404
    except (StorageError, LLMCoreError) as e:
        logger.error(
            f"Error loading context preset '{preset_name}': {e}", exc_info=True)
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
    if not llmcore_instance:
        logger.error(
            f"Attempted to update preset '{preset_name}', but LLM service is not available."
        )
        return jsonify({"error": "LLM service not available."}), 503

    data = request.json
    if (not data or "name" not in data or "items" not in data or
            data["name"] != preset_name):
        return jsonify({
            "error":
            "Payload must include 'name' and 'items', and name must match URL."
        }), 400

    try:
        preset_items = [ContextPresetItem(**item) for item in data["items"]]
        updated_preset = await llmcore_instance.save_context_preset(
            preset_name=data["name"],
            description=data.get("description"),
            items=preset_items,
            metadata=data.get("metadata"),
        )
        logger.info(f"Successfully updated context preset '{preset_name}'.")
        return jsonify(updated_preset.model_dump(mode="json"))
    except (StorageError, LLMCoreError, ValueError) as e:
        logger.error(
            f"Error updating context preset '{preset_name}': {e}",
            exc_info=True)
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
    if not llmcore_instance:
        logger.error(
            f"Attempted to delete preset '{preset_name}', but LLM service is not available."
        )
        return jsonify({"error": "LLM service not available."}), 503
    try:
        deleted = await llmcore_instance.delete_context_preset(preset_name)
        if deleted:
            logger.info(f"Successfully deleted context preset '{preset_name}'.")
            return jsonify({
                "message": f"Preset '{preset_name}' deleted successfully."
            })
        else:
            logger.warning(f"Context preset '{preset_name}' not found for deletion.")
            return jsonify({"error": "Preset not found."}), 404
    except (StorageError, LLMCoreError) as e:
        logger.error(
            f"Error deleting context preset '{preset_name}': {e}", exc_info=True)
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
    if not llmcore_instance:
        logger.error(
            f"Attempted to rename preset '{old_name}', but LLM service is not available."
        )
        return jsonify({"error": "LLM service not available."}), 503

    data = request.json
    if not data or "new_name" not in data or not data["new_name"].strip():
        return jsonify({
            "error": "Request payload must include a non-empty 'new_name'."
        }), 400

    new_name = data["new_name"].strip()
    try:
        success = await llmcore_instance.rename_context_preset(old_name, new_name)
        if success:
            logger.info(f"Successfully renamed preset '{old_name}' to '{new_name}'.")
            return jsonify({
                "message":
                f"Preset '{old_name}' renamed to '{new_name}' successfully."
            })
        else:
            logger.warning(f"Failed to rename preset '{old_name}'. It might not exist or the new name might be taken.")
            return jsonify({
                "error":
                f"Failed to rename preset '{old_name}'. The preset may not exist, or the new name '{new_name}' may already be in use."
            }), 404
    except (StorageError, LLMCoreError, ValueError) as e:
        logger.error(
            f"Error renaming preset '{old_name}' to '{new_name}': {e}",
            exc_info=True)
        return jsonify({"error": f"Failed to rename preset: {str(e)}"}), 500


logger.info("Context Preset routes defined on preset_bp.")
