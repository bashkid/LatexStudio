"""Errors that reach the page as a message with a hint (the same shape the React app shows)."""
from __future__ import annotations


class StudioError(Exception):
    status = 400

    def __init__(self, message: str, hint: str = ""):
        super().__init__(message)
        self.message = message
        self.hint = hint


class InvalidInput(StudioError):
    status = 400


class NotFound(StudioError):
    status = 404


class ToolError(StudioError):
    status = 500
