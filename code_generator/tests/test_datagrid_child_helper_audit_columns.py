"""
The generated "add child rows to an existing parent" helper
(`populate<Parent><Child>Data(parentId, length)`) must write `creator_id` and
`updater_id` when the child's Prisma model declares them (the child is also a
full entity). Embedded-only children have no audit columns and must render
exactly as before.
"""
import sys
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from build_context import set_prisma_models  # noqa: E402
from generators_test import helper_context  # noqa: E402
from helpers.naming import to_camel_case, to_pascal_case  # noqa: E402
from schema_deriver import PrismaField, PrismaModel  # noqa: E402

CONFIG = {
    "list": True, "view": True, "new": True, "edit": True,
    "delete": True, "api": True, "test": True, "fields": None,
}


def _schema() -> dict:
    return {
        "definitions": {
            "doc": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {"id": {"type": "string"}, "name": {"type": "string"}},
            },
            "doc_line": {
                "type": "object",
                "required": ["id", "doc_id", "label"],
                "properties": {
                    "id": {"type": "string"},
                    "doc_id": {"type": "string"},
                    "label": {"type": "string"},
                },
            },
        }
    }


def _model(name: str, audit: bool) -> PrismaModel:
    cols = ["id"] + (["creator_id", "updater_id"] if audit else [])
    return PrismaModel(name=name, fields={
        c: PrismaField(name=c, prisma_type="String", nullable=False, is_list=False, is_id=(c == "id"))
        for c in cols
    })


def _render(audit: bool) -> str:
    set_prisma_models({"doc_line": _model("doc_line", audit)})
    try:
        children = [{
            "name": "doc_line", "property_name": "lines", "output_type": None,
            "file_type": None, "relationship": None,
        }]
        ctx = helper_context("doc", children, _schema(), "doc", "doc", CONFIG)
        env = Environment(
            loader=FileSystemLoader(str(Path(__file__).resolve().parents[1] / "templates")),
            trim_blocks=True, lstrip_blocks=True, keep_trailing_newline=True,
        )
        env.filters["pascal_case"] = to_pascal_case
        env.filters["camel_case"] = to_camel_case
        return env.get_template("test_helper.ts.jinja2").render(**ctx)
    finally:
        set_prisma_models({})


def _child_helper(text: str) -> str:
    start = text.index("export async function populateDocDocLineData(")
    end = text.index("\nexport ", start + 1) if "\nexport " in text[start + 1:] else len(text)
    return text[start:end]


def test_child_with_audit_columns_seeds_creator_and_updater():
    body = _child_helper(_render(audit=True))
    assert "const testUser = await getTestUser();" in body
    assert "creator_id: testUser.id," in body
    assert "updater_id: testUser.id," in body


def test_embedded_child_without_audit_columns_is_unchanged():
    body = _child_helper(_render(audit=False))
    assert "creator_id" not in body
    assert "updater_id" not in body
    assert "getTestUser" not in body
