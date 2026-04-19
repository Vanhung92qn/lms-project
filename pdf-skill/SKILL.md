---
name: pdf-skill
description: Read, extract, and fill interactive PDF forms (AcroForm) from a JSON payload. Use when a workflow needs to turn structured data into a filled-in PDF (student certificates, invoices, enrollment forms) or to extract existing field values from a PDF template.
---

# pdf-skill — PDF Form Handling

A self-contained Agent Skill that lets any AI agent handle PDF form
work without shelling out to a heavyweight PDF editor. It is pure
Python, depends only on `PyPDF2 >= 3.0`, and is designed to be invoked
from another agent (agent-to-agent) or from a human shell.

## When to use this skill

Invoke this skill when one of the following is true:

- A workflow produces **structured data** (JSON) that must land inside
  an existing PDF template's form fields (e.g. name / date-of-birth /
  student ID on a certificate).
- A workflow needs to **read** the current values of a fillable PDF
  so a downstream step can validate or transform them.
- A workflow needs to **enumerate** the fields of an unfamiliar PDF
  template before designing the JSON schema for it.

Do **not** use this skill for:

- Rasterizing a PDF to images (use a dedicated renderer).
- Digital signatures / PKCS#7 (out of scope for MVP).
- Generating a PDF from scratch (use a report generator like
  WeasyPrint or ReportLab).
- Scanned PDFs with no AcroForm (they need OCR first, not form
  filling).

## Entry points

The skill exposes a single script:

```
pdf-skill/scripts/fill_form.py
```

See [REFERENCE.md](REFERENCE.md) for the full CLI and Python API
surface, and [FORMS.md](FORMS.md) for the JSON schema contract.

## Agent-to-agent invocation pattern

When another agent needs PDF form work done, it should:

1. **Resolve the template.** Either accept a path from the caller or
   download the template to a local working directory.
2. **Know the expected fields.** Either (a) rely on a pre-agreed schema
   documented in `FORMS.md`, or (b) introspect them at runtime:
   ```bash
   python pdf-skill/scripts/fill_form.py --template <path> --inspect
   ```
3. **Build the JSON payload** matching the schema described in
   [FORMS.md](FORMS.md). One flat object; keys are PDF field names,
   values are stringifiable primitives (string, number, boolean).
4. **Invoke the filler:**
   ```bash
   python pdf-skill/scripts/fill_form.py \
     --template /path/to/template.pdf \
     --data '{"full_name":"Nguyễn Văn Hùng","student_id":"SV2026-0001"}' \
     --output /path/to/filled.pdf
   ```
   or, for larger payloads:
   ```bash
   python pdf-skill/scripts/fill_form.py \
     --template template.pdf --data payload.json --output out.pdf
   ```
5. **Check the exit code and stdout.** On success, the script prints a
   JSON summary of filled / missing / unused fields to stdout. On
   failure, a message is written to stderr and a non-zero exit code is
   returned (see [REFERENCE.md §Error codes](REFERENCE.md#error-codes)).

## Design constraints

- **Stateless.** The script holds no session or credentials. Every
  invocation is independent.
- **Deterministic.** Same template + same payload ⇒ byte-identical
  output (modulo PDF metadata timestamps; we set `NeedAppearances` so
  the visual result is consistent across viewers).
- **No network access.** The skill does not fetch from URLs; the
  caller is responsible for localizing the template first.
- **No data persistence.** No temp files left behind; the script
  writes exactly one output file at the path the caller specified.

## Safety & privacy

- The skill reads and writes only paths the caller provides. It will
  not traverse outside them.
- If the caller passes a payload that includes keys not present in the
  PDF, the skill does one of two things depending on `--strict`:
  - Default: log them as `missing` in the JSON summary and keep
    going.
  - `--strict`: exit with code `12` (schema mismatch).
- The skill refuses to process PDFs without an `AcroForm` object
  (exit code `11`) rather than silently writing nothing.

## Dependencies

- Python ≥ 3.10.
- `PyPDF2 >= 3.0, < 4.0` (pinned via `requirements.txt` next to the
  script).

Install once:

```bash
pip install -r pdf-skill/scripts/requirements.txt
```

## Integration inside AI-LMS

Anticipated consumers once code lands:

- **Billing** — generate an invoice PDF from an order (feeds the
  field list `invoice_number`, `buyer_name`, `course_title`,
  `amount_vnd`, `paid_at`).
- **Catalog / Certificates** — emit a course completion certificate
  (`student_full_name`, `course_title`, `grade`, `issued_on`,
  `certificate_code`).
- **CMS** — pre-fill an enrollment form a teacher uploads as a
  template.

In each case the calling service constructs a flat JSON payload per
the contract in [FORMS.md](FORMS.md) and shells out to the script, or
imports the `fill_pdf_form` function directly when it's in the same
Python runtime.
