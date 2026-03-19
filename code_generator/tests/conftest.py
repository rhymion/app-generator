"""
Pytest configuration: add the code_generator directory to sys.path so that
the generator modules (helpers.naming, build_context, etc.) can be imported
directly from any test file.
"""
import sys
from pathlib import Path

# Make "import helpers.naming", "import build_context", etc. work
sys.path.insert(0, str(Path(__file__).parent.parent))
