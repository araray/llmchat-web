from importlib.metadata import PackageNotFoundError, version

try:
    __version__ = version("llmchat-web")
except PackageNotFoundError:
    from .get_version import _get_version_from_pyproject
    __version__ = _get_version_from_pyproject()
