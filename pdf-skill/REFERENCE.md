# REFERENCE.md — `fill_form.py` API Reference

Detailed technical reference for `pdf-skill/scripts/fill_form.py`.
For the high-level purpose and invocation patterns, see
[SKILL.md](SKILL.md). For the JSON payload schema, see
[FORMS.md](FORMS.md).

---

## Module layout

```
pdf-skill/
├── SKILL.md
├── FORMS.md
├── REFERENCE.md          ← this file
└── scripts/
    ├── fill_form.py
    └── requirements.txt
```

## Runtime requirements

- Python ≥ 3.10
- `PyPDF2 >= 3.0, < 4.0`

Install:

```bash
pip install -r pdf-skill/scripts/requirements.txt
```

---

## Command-line interface

```
python pdf-skill/scripts/fill_form.py \
  --template PATH                       # required
  ( --data JSON | --data PATH | --data - | --inspect )
  --output PATH                         # required unless --inspect
  [--strict]
  [--flatten]
  [--quiet]
```

### `--template PATH`

Path to the source PDF template. Must exist and be readable. Must
contain an `AcroForm` object; otherwise exit code `11` is returned.

### `--data VALUE`

One of:

- `PATH` — path to a `.json` file whose top-level value is an object.
- `JSON` — an inline JSON string. Must start with `{`.
- `-` — read JSON from standard input.

Required unless `--inspect` is given.

### `--output PATH`

Path to write the filled PDF. Parent directory is created if it does
not exist. An existing file at this path is overwritten.

Required unless `--inspect` is given.

### `--inspect`

Print the template's field inventory as JSON to stdout and exit 0.
Ignores `--data`, `--output`, `--strict`, `--flatten`.

Output shape:

```json
{
  "fields": {
    "student_full_name": {
      "type":          "Tx",
      "flags":         0,
      "current_value": "",
      "max_length":    64,
      "options":       null
    },
    "grade": {
      "type":          "Ch",
      "flags":         131072,
      "current_value": "",
      "max_length":    null,
      "options":       ["A", "B", "C", "D", "F"]
    }
  },
  "count": 12,
  "has_acroform": true
}
```

### `--strict`

Fail (exit code `12`) if the payload contains keys that do not exist
in the PDF. Useful in automated pipelines where unknown keys indicate
a drifted schema.

### `--flatten`

Flatten the form after filling: fields become static page content and
can no longer be edited in a PDF reader. Useful for "final" documents
like invoices and certificates.

> **Note:** Flattening uses `NeedAppearances=True` + field-widget
> appearance rebuild; a second pass with a renderer like `qpdf` may
> be needed for viewers that ignore `NeedAppearances`. This is a
> known PDF-tooling quirk.

### `--quiet`

Suppress the success summary on stdout. Errors still go to stderr.

---

## Standard output (success)

On success, stdout contains a single JSON object:

```json
{
  "filled":   ["student_full_name", "course_title", "issued_on"],
  "missing":  ["nonexistent_field_from_payload"],
  "unused":   ["signature", "notes"],
  "output":   "/abs/path/to/filled.pdf",
  "input_hash_sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
}
```

- `filled` — field names actually written.
- `missing` — keys in the payload that no field in the PDF matched.
- `unused` — fields in the PDF that received no value in the payload.
- `output` — the absolute path the filled PDF was written to.
- `input_hash_sha256` — SHA-256 of the source template (useful for
  audit trails).

---

## Python API

The script is importable. When the calling code runs in the same
Python process it should prefer the direct function call over
subprocess invocation.

### `fill_pdf_form(template_path, data, output_path, *, strict=False, flatten=False) -> dict`

Fill a PDF form and return a summary.

**Arguments**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `template_path` | `str \| pathlib.Path` | yes | Path to source PDF template. |
| `data` | `dict[str, Any]` | yes | Flat payload. Non-string values are coerced via `str()`. |
| `output_path` | `str \| pathlib.Path` | yes | Where to write the filled PDF. |
| `strict` | `bool` | no (default `False`) | Raise `KeyError` if payload has keys not in the PDF. |
| `flatten` | `bool` | no (default `False`) | Mark the output as flattened (`NeedAppearances=True`). |

**Returns** a `dict` identical to the CLI success summary (without
`input_hash_sha256`, which is added by the CLI layer).

**Raises**

| Exception | When |
|-----------|------|
| `FileNotFoundError` | `template_path` does not exist. |
| `ValueError` | The PDF has no AcroForm, no fillable fields, or the payload is not a `dict`. |
| `KeyError` | `strict=True` and the payload contains unknown field names. |
| `PyPDF2.errors.PdfReadError` | The file is not a valid PDF. |

### `inspect_pdf_form(template_path) -> dict`

Return the field inventory without modifying the file. Same shape as
the `--inspect` CLI output.

### `load_data(source) -> dict`

Helper used by the CLI. Given either a path, a raw JSON string, or
`"-"` (stdin), return the parsed object. Raises `json.JSONDecodeError`
or `ValueError` on malformed input.

---

## Error codes

| Exit code | Stream | Meaning |
|-----------|--------|---------|
| `0` | stdout | Success. |
| `1` | stderr | Unexpected / unhandled exception (printed with type name). |
| `2` | stderr | Missing runtime dependency (import error). |
| `10` | stderr | File not found (template, or data file). |
| `11` | stderr | Invalid PDF: no `AcroForm`, no fields, or not a PDF at all. |
| `12` | stderr | Schema mismatch under `--strict`: payload has unknown keys. |
| `13` | stderr | Malformed JSON payload. |
| `14` | stderr | Invalid CLI usage (e.g. missing both `--data` and `--inspect`). |

Any non-zero code should be treated as a hard failure by callers —
the output PDF is not written (or is removed if a partial write
occurred).

---

## Behavioural contract

- **Idempotent** for identical inputs: running twice with the same
  `template_path`, `data`, `output_path` yields byte-identical output
  (modulo PDF timestamp metadata which we do not control).
- **No side effects outside `output_path`** — the script does not
  modify the template, does not write temp files into the working
  directory, and does not touch any other file.
- **UTF-8 everywhere.** Payload keys/values, file paths, stdout,
  stderr.
- **Fail-fast.** If we cannot fill even one field (malformed PDF,
  missing AcroForm), we stop and return a non-zero exit code rather
  than writing a half-filled file.

---

## Testing

The script is covered by unit tests under
`pdf-skill/tests/` (added in a later phase once the Python
toolchain is wired up in the monorepo). Expected test cases:

1. Fills all known fields on a reference template; summary matches
   expectation.
2. `--strict` with an unknown key exits `12`.
3. Missing template exits `10`.
4. Invalid PDF exits `11`.
5. UTF-8 Vietnamese values round-trip correctly.
6. `--inspect` returns the correct field inventory.
7. Empty payload leaves all fields untouched; `unused` equals full
   field list.
