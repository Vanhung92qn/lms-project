#!/usr/bin/env python3
"""
fill_form.py — fill an interactive PDF form from a JSON payload.

See ../SKILL.md for purpose and ../REFERENCE.md for the full API.
Minimum runtime: Python 3.10, PyPDF2 >= 3.0, < 4.0.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

# Dependency guard. PyPDF2 is the only external dep; failing import must
# produce exit-code 2 (not 1) so callers can distinguish "install me" from
# "unexpected crash".
try:
    from PyPDF2 import PdfReader, PdfWriter
    from PyPDF2.generic import BooleanObject, NameObject, TextStringObject
except ImportError as _e:  # pragma: no cover
    sys.stderr.write(
        "[fill_form] missing dependency PyPDF2 — install with "
        "`pip install -r pdf-skill/scripts/requirements.txt`\n"
    )
    sys.exit(2)


# ---------------------------------------------------------------------------
# Data loading helpers
# ---------------------------------------------------------------------------


def load_data(source: str) -> dict[str, Any]:
    """
    Accept a JSON payload from a file path, an inline JSON string, or stdin.

    `source == "-"` means read stdin. Otherwise, if `source` points at an
    existing file we read the file; else we treat `source` itself as the JSON
    literal. The top-level value must be an object (dict).
    """
    if source == "-":
        payload = json.load(sys.stdin)
    else:
        candidate = Path(source)
        if candidate.exists():
            payload = json.loads(candidate.read_text(encoding="utf-8"))
        else:
            payload = json.loads(source)

    if not isinstance(payload, dict):
        raise ValueError("payload must be a JSON object at the top level")
    return payload


def _sha256_of(path: Path) -> str:
    """SHA-256 of a file, used for audit trails in the CLI summary."""
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


# ---------------------------------------------------------------------------
# Core API
# ---------------------------------------------------------------------------


def inspect_pdf_form(template_path: str | Path) -> dict[str, Any]:
    """
    Return a JSON-serializable inventory of AcroForm fields for a template.

    See REFERENCE.md for the output shape.
    """
    src = Path(template_path)
    if not src.exists():
        raise FileNotFoundError(f"template not found: {template_path}")

    reader = PdfReader(str(src))
    has_acroform = "/AcroForm" in reader.trailer["/Root"]
    fields_raw = reader.get_fields() or {}

    fields: dict[str, dict[str, Any]] = {}
    for name, meta in fields_raw.items():
        # meta is a PyPDF2 Field object; attribute access handles both dict-style
        # and attribute-style field metadata.
        fields[name] = {
            "type": getattr(meta, "field_type", None) or meta.get("/FT"),
            "flags": getattr(meta, "field_flags", None) or meta.get("/Ff", 0) or 0,
            "current_value": getattr(meta, "value", None) or meta.get("/V") or "",
            "max_length": meta.get("/MaxLen"),
            "options": _extract_options(meta.get("/Opt")),
        }

    return {"fields": fields, "count": len(fields), "has_acroform": has_acroform}


def _extract_options(raw: Any) -> list[str] | None:
    """
    Normalize the many shapes /Opt can take into a plain list[str] or None.
    """
    if raw is None:
        return None
    out: list[str] = []
    for item in raw:
        # /Opt entries can be either a bare string or a [export_value, display]
        if isinstance(item, (list, tuple)) and item:
            out.append(str(item[0]))
        else:
            out.append(str(item))
    return out or None


def fill_pdf_form(
    template_path: str | Path,
    data: dict[str, Any],
    output_path: str | Path,
    *,
    strict: bool = False,
    flatten: bool = False,
) -> dict[str, Any]:
    """
    Fill a PDF's AcroForm fields with values from `data`.

    Keys in `data` must match AcroForm field names exactly. Values are coerced
    to str (caller is responsible for locale / date formatting — see FORMS.md).
    Returns a summary dict with `filled`, `missing`, `unused`, and `output`.
    """
    if not isinstance(data, dict):
        raise ValueError("data must be a dict")

    src = Path(template_path)
    if not src.exists():
        raise FileNotFoundError(f"template not found: {template_path}")

    reader = PdfReader(str(src))
    if "/AcroForm" not in reader.trailer["/Root"]:
        raise ValueError("pdf has no AcroForm — nothing to fill")

    form_fields = reader.get_fields() or {}
    if not form_fields:
        raise ValueError("pdf form contains zero fields")

    missing = [key for key in data if key not in form_fields]
    if strict and missing:
        raise KeyError(f"unknown field(s) in data: {missing}")

    # Only write values for keys that correspond to real fields, so that
    # strays in the payload never touch the PDF.
    to_write: dict[str, str] = {
        k: _coerce_value(v) for k, v in data.items() if k in form_fields
    }

    writer = PdfWriter(clone_from=reader)

    # NeedAppearances tells PDF readers to regenerate field appearances after
    # we write new values. Without it, some viewers (older Acrobat, Chrome's
    # built-in) show the old blank appearance even though the value is set.
    acro = writer._root_object["/AcroForm"]  # noqa: SLF001 — documented PyPDF2 pattern
    acro.update({NameObject("/NeedAppearances"): BooleanObject(True)})

    for page in writer.pages:
        # update_page_form_field_values silently skips fields not on this page,
        # so it is safe to call once per page with the full dict.
        writer.update_page_form_field_values(page, to_write)

    if flatten:
        # Mark every field as read-only; a subsequent renderer pass will bake
        # the visual into page content. Full flattening requires a renderer
        # that respects /NeedAppearances — see REFERENCE.md for the caveat.
        for page in writer.pages:
            if "/Annots" in page:
                for annot_ref in page["/Annots"]:
                    annot = annot_ref.get_object()
                    if annot.get("/Subtype") == "/Widget":
                        annot.update({NameObject("/Ff"): TextStringObject("1")})

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("wb") as fh:
        writer.write(fh)

    filled = list(to_write.keys())
    unused = [name for name in form_fields if name not in to_write]
    return {
        "filled": filled,
        "missing": missing,
        "unused": unused,
        "output": str(out.resolve()),
    }


def _coerce_value(value: Any) -> str:
    """
    Coerce payload values into the strings AcroForm expects.

    Booleans → "/Yes" / "/Off" for checkbox compatibility. Everything else is
    `str()`-ified. Callers needing locale-aware formatting (dates, currency)
    must format on their side before passing the value in.
    """
    if isinstance(value, bool):
        return "/Yes" if value else "/Off"
    if value is None:
        # Deliberately convert None to empty string rather than "None". Callers
        # should really omit the key, but this is the safer default on the way
        # out.
        return ""
    return str(value)


# ---------------------------------------------------------------------------
# CLI entrypoint
# ---------------------------------------------------------------------------


def _build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="fill_form.py",
        description="Fill an interactive PDF form from a JSON payload.",
    )
    p.add_argument("--template", "-t", required=True, help="path to source PDF template")
    p.add_argument(
        "--data",
        "-d",
        help="path to JSON file, inline JSON string, or '-' to read stdin",
    )
    p.add_argument("--output", "-o", help="path to write filled PDF")
    p.add_argument(
        "--inspect",
        action="store_true",
        help="print AcroForm field inventory as JSON and exit",
    )
    p.add_argument(
        "--strict",
        action="store_true",
        help="exit non-zero if payload contains unknown field names",
    )
    p.add_argument(
        "--flatten",
        action="store_true",
        help="mark widgets read-only after filling (best-effort flatten)",
    )
    p.add_argument("--quiet", action="store_true", help="suppress success summary on stdout")
    return p


def main(argv: list[str] | None = None) -> int:
    parser = _build_arg_parser()
    args = parser.parse_args(argv)

    # --- inspect branch -----------------------------------------------------
    if args.inspect:
        try:
            inventory = inspect_pdf_form(args.template)
        except FileNotFoundError as e:
            sys.stderr.write(f"[fill_form] {e}\n")
            return 10
        except ValueError as e:
            sys.stderr.write(f"[fill_form] invalid pdf: {e}\n")
            return 11
        except Exception as e:  # pragma: no cover — truly unexpected
            sys.stderr.write(f"[fill_form] {type(e).__name__}: {e}\n")
            return 1
        sys.stdout.write(json.dumps(inventory, ensure_ascii=False, indent=2) + "\n")
        return 0

    # --- fill branch --------------------------------------------------------
    if args.data is None or args.output is None:
        sys.stderr.write(
            "[fill_form] --data and --output are required unless --inspect is given\n"
        )
        return 14

    try:
        payload = load_data(args.data)
    except FileNotFoundError as e:
        sys.stderr.write(f"[fill_form] {e}\n")
        return 10
    except json.JSONDecodeError as e:
        sys.stderr.write(f"[fill_form] malformed json: {e}\n")
        return 13
    except ValueError as e:
        sys.stderr.write(f"[fill_form] bad payload: {e}\n")
        return 13

    try:
        summary = fill_pdf_form(
            args.template,
            payload,
            args.output,
            strict=args.strict,
            flatten=args.flatten,
        )
    except FileNotFoundError as e:
        sys.stderr.write(f"[fill_form] {e}\n")
        return 10
    except KeyError as e:
        sys.stderr.write(f"[fill_form] schema mismatch (--strict): {e}\n")
        return 12
    except ValueError as e:
        sys.stderr.write(f"[fill_form] invalid pdf: {e}\n")
        return 11
    except Exception as e:  # pragma: no cover — PyPDF2 read errors land here
        sys.stderr.write(f"[fill_form] {type(e).__name__}: {e}\n")
        return 1

    summary["input_hash_sha256"] = _sha256_of(Path(args.template))

    if not args.quiet:
        sys.stdout.write(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
